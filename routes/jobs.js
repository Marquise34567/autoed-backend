const express = require('express')
const crypto = require('crypto')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const admin = require('../utils/firebaseAdmin')
const { processJob } = require('../services/worker/processJob')
const db = admin.db

async function processVideo(jobId, inputSpec) {
  console.log('Processing started:', jobId)
  try {
    // Mark processing started
    await db.collection('jobs').doc(jobId).set({ status: 'processing', progress: 0, message: 'Processing started', updatedAt: Date.now() }, { merge: true })

    const bucket = admin.getBucket()

    // Determine input source
    let downloadURL = null
    let gsPath = null
    if (typeof inputSpec === 'string') gsPath = inputSpec
    else {
      downloadURL = inputSpec.downloadURL || inputSpec.downloadUrl || null
      gsPath = inputSpec.storagePath || inputSpec.gsUri || inputSpec.path || null
    }

    // Download to /tmp/uploads
    const tmpDir = path.resolve(process.cwd(), 'tmp', 'uploads')
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpBase = (gsPath ? path.basename(gsPath) : `download-${jobId}.bin`).replace(/[^a-z0-9.\-_]/gi, '_')
    const localIn = path.resolve(tmpDir, `${jobId}-${tmpBase}`)

    if (downloadURL) {
      console.log(`[jobs:${jobId}] Input source: downloadURL`)
      await new Promise((resolve, reject) => {
        try {
          const u = new URL(downloadURL)
          const lib = u.protocol === 'https:' ? require('https') : require('http')
          const req = lib.get(u, (res) => {
            if (!res.statusCode || res.statusCode >= 400) return reject(new Error(`Failed to fetch ${downloadURL}: status ${res.statusCode}`))
            const fileStream = fs.createWriteStream(localIn)
            res.pipe(fileStream)
            fileStream.on('finish', () => resolve())
            fileStream.on('error', reject)
          })
          req.on('error', reject)
        } catch (err) {
          return reject(err)
        }
      })
      await db.collection('jobs').doc(jobId).set({ progress: 10, message: 'Downloaded input (from URL)', updatedAt: Date.now() }, { merge: true })
    } else if (gsPath) {
      console.log(`[jobs:${jobId}] Input source: gsUri`)
      // Support gs://bucket/path or plain storage-relative path
      let filePath = gsPath
      if (gsPath.startsWith('gs://')) {
        const without = gsPath.replace(/^gs:\/\//i, '')
        const idx = without.indexOf('/')
        if (idx > 0) {
          const bucketName = without.slice(0, idx)
          filePath = without.slice(idx + 1)
          const otherBucket = admin.storage().bucket(bucketName)
          const remoteFile = otherBucket.file(filePath)
          const [exists] = await remoteFile.exists()
          if (!exists) {
            console.error(`[jobs:${jobId}] Source file not found: ${gsPath}`)
            await db.collection('jobs').doc(jobId).set({ status: 'failed', progress: 0, message: 'Source file not found', error: 'Source file missing', updatedAt: Date.now() }, { merge: true })
            return
          }
          await remoteFile.download({ destination: localIn })
        } else {
          console.error(`[jobs:${jobId}] Invalid gs:// URI: ${gsPath}`)
          await db.collection('jobs').doc(jobId).set({ status: 'failed', progress: 0, message: 'Invalid gsUri', error: 'Invalid gsUri', updatedAt: Date.now() }, { merge: true })
          return
        }
      } else {
        const remoteFile = bucket.file(filePath)
        const [exists] = await remoteFile.exists()
        if (!exists) {
          console.error(`[jobs:${jobId}] Source file not found: ${filePath}`)
          await db.collection('jobs').doc(jobId).set({ status: 'failed', progress: 0, message: 'Source file not found', error: 'Source file missing', updatedAt: Date.now() }, { merge: true })
          return
        }
        await remoteFile.download({ destination: localIn })
      }
      await db.collection('jobs').doc(jobId).set({ progress: 10, message: 'Downloaded input', updatedAt: Date.now() }, { merge: true })
    } else {
      console.error(`[jobs:${jobId}] No input source provided`)
      await db.collection('jobs').doc(jobId).set({ status: 'failed', progress: 0, message: 'No input source', error: 'Missing input', updatedAt: Date.now() }, { merge: true })
      return
    }

    // Run ffmpeg
    const tmpOutDir = path.resolve(process.cwd(), 'tmp', 'renders')
    fs.mkdirSync(tmpOutDir, { recursive: true })
    const localOut = path.resolve(tmpOutDir, `${jobId}-final.mp4`)
    const ffmpegCmd = `ffmpeg -y -i "${localIn}" -c:v libx264 -preset veryfast -crf 23 -c:a aac -movflags +faststart "${localOut}"`
    console.log(`[jobs:${jobId}] Running FFmpeg: ${ffmpegCmd}`)
    await new Promise((resolve, reject) => {
      const proc = exec(ffmpegCmd, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
        if (error) return reject(error)
        return resolve({ stdout, stderr })
      })
      if (proc.stdout && proc.stdout.on) proc.stdout.on('data', (d) => console.log(`[jobs:${jobId}] ffmpeg: ${String(d).trim()}`))
      if (proc.stderr && proc.stderr.on) proc.stderr.on('data', (d) => console.log(`[jobs:${jobId}] ffmpeg: ${String(d).trim()}`))
    })
    console.log('FFmpeg finished')
    await db.collection('jobs').doc(jobId).set({ progress: 70, message: 'FFmpeg finished', updatedAt: Date.now() }, { merge: true })

    // Upload result
    const finalPath = `outputs/${jobId}/final.mp4`
    console.log(`[jobs:${jobId}] Uploading result to ${finalPath}`)
    await bucket.upload(localOut, { destination: finalPath })
    console.log('Upload finished')
    const bucketName = admin.getBucketName()
    const resultUrl = `https://storage.googleapis.com/${bucketName}/${finalPath}`
    await db.collection('jobs').doc(jobId).set({ status: 'completed', progress: 100, resultUrl, finalVideoPath: finalPath, message: 'Completed', updatedAt: Date.now() }, { merge: true })
    console.log(`Processing completed: ${jobId} resultUrl=${resultUrl}`)

    // cleanup
    try { fs.unlinkSync(localIn) } catch (e) {}
    try { fs.unlinkSync(localOut) } catch (e) {}
  } catch (err) {
    console.error(`[jobs:${jobId}] processing error:`, err && (err.stack || err.message || err))
    try { await db.collection('jobs').doc(jobId).set({ status: 'failed', progress: 0, error: err && (err.message || String(err)), updatedAt: Date.now() }, { merge: true }) } catch (e) { console.error('[jobs] failed to write error state to Firestore', e) }
  }
}

// In-memory job store for now
const jobs = new Map()

function makeJob({ id, path = null, filename = null, contentType = null }) {
  const createdAt = new Date().toISOString()
  return {
    id,
    status: 'queued',
    progress: 0,
    createdAt,
    path,
    filename,
    contentType,
  }
}

// List jobs
router.get('/', (req, res) => {
  const arr = Array.from(jobs.values())
  return res.status(200).json({ ok: true, jobs: arr })
})

// Get single job by id, create placeholder if missing
router.get('/:id', (req, res) => {
  const id = req.params.id
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' })
  ;(async () => {
    try {
      // Prefer Firestore job status if available
      if (db) {
        const snap = await db.collection('jobs').doc(id).get()
        if (snap && snap.exists) {
          return res.status(200).json({ ok: true, job: snap.data() })
        }
      }
      let job = jobs.get(id)
      if (!job) {
        job = makeJob({ id })
        jobs.set(id, job)
        console.log(`[jobs] created ${id} path=${job.path}`)
      }
      return res.status(200).json({ ok: true, job })
    } catch (e) {
      console.error('[jobs] GET /:id error', e)
      return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) })
    }
  })()
})

// Create a job
router.post('/', (req, res) => {
  try {
    // Debug logging to help verify incoming requests (one-time per deploy is fine)
    console.log('[jobs] req.headers content-type:', req.headers['content-type'])
    console.log('[jobs] req.body typeof:', typeof req.body, 'body:', req.body)

    const body = req.body || {}
    const { storagePath, gsUri: incomingGsUri, downloadURL, path: objectPath } = body

    // Accept any one of: storagePath OR gsUri OR downloadURL
    const receivedPath = storagePath || incomingGsUri || objectPath || downloadURL || null
    if (!receivedPath) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: storagePath|gsUri|downloadURL', received: { storagePath, gsUri: incomingGsUri, downloadURL } })
    }

    const jobId = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.floor(Math.random() * 100000)}`
    // Normalize to a canonical gs:// URI when possible
    let canonicalPath = incomingGsUri || null
    if (!canonicalPath && storagePath) {
      const bn = admin.getBucketName && admin.getBucketName()
      if (bn) canonicalPath = `gs://${bn}/${storagePath}`
      else canonicalPath = storagePath
    }
    if (!canonicalPath && objectPath) canonicalPath = objectPath
    const job = makeJob({ id: jobId, path: canonicalPath })
    jobs.set(jobId, job)
    console.log(`JOB CREATED ${jobId} path=${objectPath}`)

    // Persist a Firestore job document so other clients can observe progress
    ;(async () => {
      try {
        const now = new Date().getTime()
        await db.collection('jobs').doc(jobId).set({
          id: jobId,
          uid: null,
          phase: 'QUEUED',
          status: 'queued',
          progress: 0,
          message: 'Job queued',
          createdAt: now,
          updatedAt: now,
          objectPathOriginal: canonicalPath,
          logs: [`Job created via Express POST`],
        }, { merge: true })
      } catch (e) {
        console.error('[jobs] failed to persist job to Firestore', e)
      }
    })()

    // Schedule processing without blocking response
    // Prepare inputSpec for background processing. Prefer a canonical gsUri when available.
    const gsUri = incomingGsUri || (storagePath && (admin.getBucketName ? `gs://${admin.getBucketName()}/${storagePath}` : null)) || undefined
    job.inputSpec = { storagePath: storagePath || undefined, gsUri: gsUri || undefined, downloadURL: downloadURL || undefined }
    setImmediate(() => {
      console.log(`JOB START ${jobId}`)
      processJob(jobId, job.inputSpec).catch((e) => {
        console.error(`JOB ERROR ${jobId}`, e)
        try { db.collection('jobs').doc(jobId).set({ status: 'error', error: e && (e.message || String(e)), updatedAt: Date.now() }, { merge: true }) } catch (_) {}
      })
    })

    return res.status(200).json({ ok: true, jobId })
  } catch (err) {
    console.error('[jobs] POST error', err && err.message ? err.message : err)
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : 'Internal error' })
  }
})

module.exports = router
