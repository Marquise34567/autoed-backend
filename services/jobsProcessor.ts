import path from 'path'
import fs from 'fs'
import { getBucket } from '@/lib/firebaseAdmin'
import normalizeToMp4 from '@/lib/ffmpeg/normalize'
import { probeDurationSec, detectSilenceSegments, selectBoringCuts, analyzeVideo } from '@/lib/videoAnalysis'
import { renderEditedVideo } from '@/lib/ffmpeg/renderEdited'
import { updateJob, appendJobLog } from './jobs'

export async function processVideo(jobId: string, storagePath: string) {
  console.log(`[jobsProcessor:${jobId}] Processing started`)
  try {
    await updateJob(jobId, { status: 'processing', progress: 0, phase: 'NORMALIZING', message: 'Processing started' })
    appendJobLog(jobId, 'Processing started')

    // Ensure bucket available
    let bucket
    try {
      bucket = getBucket()
    } catch (e: any) {
      console.error(`[jobsProcessor:${jobId}] Storage bucket not configured`, e)
      await updateJob(jobId, { status: 'error', progress: 0, phase: 'ERROR', message: 'Storage not configured', error: 'FIREBASE_STORAGE_BUCKET missing' })
      appendJobLog(jobId, 'Storage bucket missing; aborting')
      return
    }

    // check existence
    const remoteFile = bucket.file(storagePath)
    const [exists] = await remoteFile.exists()
    if (!exists) {
      console.error(`[jobsProcessor:${jobId}] Source file not found: ${storagePath}`)
      await updateJob(jobId, { status: 'error', progress: 0, phase: 'ERROR', message: 'Source file not found', error: 'Source file missing' })
      appendJobLog(jobId, `Source file not found: ${storagePath}`)
      return
    }

    const uploadDir = path.resolve(process.cwd(), 'tmp', 'uploads')
    fs.mkdirSync(uploadDir, { recursive: true })
    const safeName = path.basename(storagePath).replace(/[^a-z0-9.\-_]/gi, '_')
    const tmpInput = path.resolve(uploadDir, `${jobId}-${safeName}`)

    console.log(`[jobsProcessor:${jobId}] Downloading video`)
    appendJobLog(jobId, `Downloading ${storagePath} to ${tmpInput}`)
    await remoteFile.download({ destination: tmpInput })
    await updateJob(jobId, { progress: 10, message: 'Downloaded input' })

    console.log(`[jobsProcessor:${jobId}] Running ffmpeg (normalize)`)
    await updateJob(jobId, { progress: 20, message: 'Normalizing input' })
    const normalizedLocal = path.resolve(uploadDir, `${jobId}-normalized.mp4`)
    const normRes = await normalizeToMp4(tmpInput, normalizedLocal, jobId)
    if (!normRes || !normRes.success) {
      console.error(`[jobsProcessor:${jobId}] Normalization failed`, normRes)
      await updateJob(jobId, { status: 'error', progress: 0, phase: 'ERROR', message: 'Normalization failed', error: normRes?.error || 'Normalization failed' })
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

    await updateJob(jobId, { status: 'completed', progress: 100, phase: 'DONE', message: 'Job completed', finalVideoPath: finalPath })
    appendJobLog(jobId, 'Job completed')
    console.log(`[jobsProcessor:${jobId}] Job completed`)

    // cleanup
    try { fs.unlinkSync(renderLocal) } catch (e) { /* ignore */ }
    try { fs.unlinkSync(normalizedLocal) } catch (e) { /* ignore */ }
    try { fs.unlinkSync(tmpInput) } catch (e) { /* ignore */ }
  } catch (err: any) {
    console.error(`[jobsProcessor:${jobId}] Unhandled processing error:`, err && (err.stack || err.message || err))
    appendJobLog(jobId, `Processing exception: ${err?.message || String(err)}`)
    await updateJob(jobId, { status: 'error', progress: 0, phase: 'ERROR', message: 'Processing failed', error: err?.message || String(err) })
  }
}

export default { processVideo }
