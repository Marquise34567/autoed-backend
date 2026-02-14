import path from 'path'
import fs from 'fs'
import http from 'http'
import https from 'https'
import { getBucket } from '@/lib/firebaseAdmin'
import normalizeToMp4 from '@/lib/ffmpeg/normalize'
import { probeDurationSec, detectSilenceSegments, selectBoringCuts, analyzeVideo } from '@/lib/videoAnalysis'
import { renderEditedVideo } from '@/lib/ffmpeg/renderEdited'
import { updateJob, appendJobLog } from './jobs'

type InputSpec = string | { storagePath?: string; gsUri?: string; downloadURL?: string }

export async function processVideo(jobId: string, input: InputSpec) {
  console.log(`[jobsProcessor:${jobId}] Processing started`)
  try {
    await updateJob(jobId, { status: 'PROCESSING', progress: 0, phase: 'NORMALIZING', message: 'Processing started' })
    appendJobLog(jobId, 'Processing started')

    // Ensure bucket available
    let bucket
    try {
      bucket = getBucket()
    } catch (e: any) {
      console.error(`[jobsProcessor:${jobId}] Storage bucket not configured`, e)
      await updateJob(jobId, { status: 'FAILED', progress: 0, phase: 'ERROR', message: 'Storage not configured', errorMessage: 'FIREBASE_STORAGE_BUCKET missing' })
      appendJobLog(jobId, 'Storage bucket missing; aborting')
      return
    }

    // Determine input source. Prefer downloadURL, then gsUri/storagePath.
    let downloadURL: string | null = null
    let gsPath: string | null = null
    if (typeof input === 'string') {
      gsPath = input
    } else {
      downloadURL = (input as any).downloadURL || (input as any).downloadUrl || null
      gsPath = (input as any).storagePath || (input as any).gsUri || null
    }

    const uploadDir = path.resolve(process.cwd(), 'tmp', 'uploads')
    fs.mkdirSync(uploadDir, { recursive: true })
    const tmpBaseName = (gsPath ? path.basename(gsPath) : `download-${jobId}.bin`).replace(/[^a-z0-9.\-_]/gi, '_')
    const tmpInput = path.resolve(uploadDir, `${jobId}-${tmpBaseName}`)

    if (downloadURL) {
      console.log(`[jobsProcessor:${jobId}] Input source: downloadURL (${downloadURL})`)
      appendJobLog(jobId, `Downloading from downloadURL to ${tmpInput}`)
      await new Promise<void>((resolve, reject) => {
        try {
          const u = new URL(downloadURL as string)
          const lib = u.protocol === 'https:' ? https : http
          const req = lib.get(u, (res) => {
            if (!res.statusCode || res.statusCode >= 400) return reject(new Error(`Failed to fetch ${downloadURL}: status ${res.statusCode}`))
            const fileStream = fs.createWriteStream(tmpInput)
            res.pipe(fileStream)
            fileStream.on('finish', () => resolve())
            fileStream.on('error', (err) => reject(err))
          })
          req.on('error', reject)
        } catch (err) {
          return reject(err)
        }
      })
      await updateJob(jobId, { progress: 10, message: 'Downloaded input (from URL)' })
    } else if (gsPath) {
      console.log(`[jobsProcessor:${jobId}] Input source: gsUri`)
      appendJobLog(jobId, `Downloading ${gsPath} to ${tmpInput}`)

      // Support gs://bucket/path or plain storage-relative path
      let filePath = gsPath
      if (gsPath.startsWith('gs://')) {
        const without = gsPath.replace(/^gs:\/\//i, '')
        const idx = without.indexOf('/')
        if (idx > 0) {
          const bucketName = without.slice(0, idx)
          filePath = without.slice(idx + 1)
          const otherBucket = getBucket(bucketName)
          const remoteFile = otherBucket.file(filePath)
          const [exists] = await remoteFile.exists()
          if (!exists) {
            console.error(`[jobsProcessor:${jobId}] Source file not found: ${gsPath}`)
            await updateJob(jobId, { status: 'FAILED', progress: 0, phase: 'ERROR', message: 'Source file not found', errorMessage: 'Source file missing' })
            appendJobLog(jobId, `Source file not found: ${gsPath}`)
            return
          }
          await remoteFile.download({ destination: tmpInput })
          await updateJob(jobId, { progress: 10, message: 'Downloaded input' })
        } else {
          console.error(`[jobsProcessor:${jobId}] Invalid gs:// URI: ${gsPath}`)
          await updateJob(jobId, { status: 'FAILED', progress: 0, phase: 'ERROR', message: 'Invalid gsUri', errorMessage: 'Invalid gsUri' })
          appendJobLog(jobId, `Invalid gsUri: ${gsPath}`)
          return
        }
      } else {
        const remoteFile = bucket.file(filePath)
        const [exists] = await remoteFile.exists()
        if (!exists) {
          console.error(`[jobsProcessor:${jobId}] Source file not found: ${filePath}`)
          await updateJob(jobId, { status: 'FAILED', progress: 0, phase: 'ERROR', message: 'Source file not found', errorMessage: 'Source file missing' })
          appendJobLog(jobId, `Source file not found: ${filePath}`)
          return
        }
        const safeName = path.basename(filePath).replace(/[^a-z0-9.\-_]/gi, '_')
        await remoteFile.download({ destination: tmpInput })
        await updateJob(jobId, { progress: 10, message: 'Downloaded input' })
      }
    } else {
      console.error(`[jobsProcessor:${jobId}] No input source provided`)
      await updateJob(jobId, { status: 'FAILED', progress: 0, phase: 'ERROR', message: 'No input source', errorMessage: 'Missing input' })
      appendJobLog(jobId, 'No input source specified; aborting')
      return
    }

    console.log(`[jobsProcessor:${jobId}] Running ffmpeg (normalize)`)
    await updateJob(jobId, { progress: 20, message: 'Normalizing input' })
    const normalizedLocal = path.resolve(uploadDir, `${jobId}-normalized.mp4`)
    const normRes = await normalizeToMp4(tmpInput, normalizedLocal, jobId)
    if (!normRes || !normRes.success) {
      console.error(`[jobsProcessor:${jobId}] Normalization failed`, normRes)
      await updateJob(jobId, { status: 'FAILED', progress: 0, phase: 'ERROR', message: 'Normalization failed', errorMessage: normRes?.error || 'Normalization failed' })
      appendJobLog(jobId, `Normalization failed: ${JSON.stringify(normRes).slice(0,200)}`)
      return
    }
    await updateJob(jobId, { progress: 30, message: 'Normalized input', objectPathNormalized: null })

    // analysis
    console.log(`[jobsProcessor:${jobId}] Analyzing video`)
    appendJobLog(jobId, `Probing duration for ${normalizedLocal}`)
    const durationSec = await probeDurationSec(normalizedLocal)
    appendJobLog(jobId, `Duration: ${durationSec}s`)
    await updateJob(jobId, { progress: 40, message: 'Analyzing video', durationSec })

    const silenceSegments = await detectSilenceSegments(normalizedLocal)
    appendJobLog(jobId, `Detected ${silenceSegments.length} silence segments`)
    await updateJob(jobId, { progress: 50, message: 'Selecting hooks' })

    const analysis = await analyzeVideo(normalizedLocal)
    const hook = (analysis.hookCandidates && analysis.hookCandidates.length) ? analysis.hookCandidates[0] : { start: 0, end: Math.min(7, Math.floor(durationSec)) }
    appendJobLog(jobId, `Selected hook at ${hook.start}-${hook.end}`)
    await updateJob(jobId, { progress: 55, hook })

    console.log(`[jobsProcessor:${jobId}] Running ffmpeg (render)`)
    await updateJob(jobId, { progress: 65, message: 'Rendering final video' })
    const renderLocal = path.resolve(process.cwd(), 'tmp', 'renders', `${jobId}-final.mp4`)
    fs.mkdirSync(path.dirname(renderLocal), { recursive: true })
    try {
      await renderEditedVideo(normalizedLocal, { start: hook.start, end: hook.end }, [], renderLocal)
      appendJobLog(jobId, `Rendered final to ${renderLocal}`)
    } catch (e: any) {
      appendJobLog(jobId, `Render failed, copying normalized as fallback: ${e?.message || String(e)}`)
      fs.copyFileSync(normalizedLocal, renderLocal)
    }

    console.log(`[jobsProcessor:${jobId}] Uploading result`)
    await updateJob(jobId, { progress: 80, message: 'Uploading result' })
    const finalPath = `outputs/${jobId}/final.mp4`
    const finalFile = bucket.file(finalPath)
    await finalFile.save(fs.readFileSync(renderLocal), { resumable: false, contentType: 'video/mp4' })
    appendJobLog(jobId, `Uploaded final to ${finalPath}`)

    await updateJob(jobId, { status: 'COMPLETE', progress: 100, phase: 'DONE', message: 'Job completed', finalVideoPath: finalPath })
    appendJobLog(jobId, 'Job completed')
    console.log(`[jobsProcessor:${jobId}] Job completed`)

    // cleanup
    try { fs.unlinkSync(renderLocal) } catch (e) { /* ignore */ }
    try { fs.unlinkSync(normalizedLocal) } catch (e) { /* ignore */ }
    try { fs.unlinkSync(tmpInput) } catch (e) { /* ignore */ }
  } catch (err: any) {
    console.error(`[jobsProcessor:${jobId}] Unhandled processing error:`, err && (err.stack || err.message || err))
    appendJobLog(jobId, `Processing exception: ${err?.message || String(err)}`)
    await updateJob(jobId, { status: 'FAILED', progress: 0, phase: 'ERROR', message: 'Processing failed', errorMessage: err?.message || String(err) })
  }
}

export default { processVideo }
