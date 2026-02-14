const express = require('express')
const crypto = require('crypto')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const admin = require('../utils/firebaseAdmin')
const { getSignedUrlForPath, attachSignedUrlsToJob } = require('../utils/storageSignedUrl')
const { processJob } = require('../services/worker/processJob')
const { enqueue, reenqueue, listQueued } = require('../services/worker/queue')
const db = admin.db

async function processVideo(jobId, inputSpec) {
  console.log('Processing started:', jobId)
  try {
    // Mark processing started
    await db.collection('jobs').doc(jobId).set({ status: 'PROCESSING', progress: 0, message: 'Processing started', updatedAt: Date.now() }, { merge: true })

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
            await db.collection('jobs').doc(jobId).set({ status: 'FAILED', progress: 0, message: 'Source file not found', errorMessage: 'Source file missing', updatedAt: Date.now() }, { merge: true })
            return
          }
          await remoteFile.download({ destination: localIn })
        } else {
          console.error(`[jobs:${jobId}] Invalid gs:// URI: ${gsPath}`)
          await db.collection('jobs').doc(jobId).set({ status: 'FAILED', progress: 0, message: 'Invalid gsUri', errorMessage: 'Invalid gsUri', updatedAt: Date.now() }, { merge: true })
          return
        }
      } else {
        const remoteFile = bucket.file(filePath)
        const [exists] = await remoteFile.exists()
        if (!exists) {
          console.error(`[jobs:${jobId}] Source file not found: ${filePath}`)
          await db.collection('jobs').doc(jobId).set({ status: 'FAILED', progress: 0, message: 'Source file not found', errorMessage: 'Source file missing', updatedAt: Date.now() }, { merge: true })
          return
        }
        await remoteFile.download({ destination: localIn })
      }
      await db.collection('jobs').doc(jobId).set({ progress: 10, message: 'Downloaded input', updatedAt: Date.now() }, { merge: true })
    } else {
      console.error(`[jobs:${jobId}] No input source provided`)
      await db.collection('jobs').doc(jobId).set({ status: 'FAILED', progress: 0, message: 'No input source', errorMessage: 'Missing input', updatedAt: Date.now() }, { merge: true })
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
    // Generate a time-limited signed URL for clients instead of a public URL
    let resultUrl = null
    try {
      resultUrl = await getSignedUrlForPath(finalPath, 30)
    } catch (e) {
      // fall back to storing path if signed URL generation fails
      resultUrl = null
    }
    await db.collection('jobs').doc(jobId).set({ status: 'COMPLETE', progress: 100, resultUrl, finalVideoPath: finalPath, message: 'Completed', updatedAt: Date.now() }, { merge: true })
    console.log(`Processing completed: ${jobId} resultPath=${finalPath}`)

    // cleanup
    try { fs.unlinkSync(localIn) } catch (e) {}
    try { fs.unlinkSync(localOut) } catch (e) {}
    } catch (err) {
    console.error(`[jobs:${jobId}] processing error:`, err && (err.stack || err.message || err))
    try { await db.collection('jobs').doc(jobId).set({ status: 'FAILED', progress: 0, errorMessage: err && (err.message || String(err)), updatedAt: Date.now() }, { merge: true }) } catch (e) { console.error('[jobs] failed to write error state to Firestore', e) }
  }
}

function normalizeJobRecord(raw) {
  if (!raw) return null
  const job = { ...raw }
  // normalize status strings
  const s = (job.status || job.state || '').toString().toUpperCase()
  if (s === 'DONE' || s === 'COMPLETED' || s === 'COMPLETE') job.status = 'COMPLETE'
  else if (s === 'PROCESSING') job.status = 'PROCESSING'
  else if (s === 'QUEUED') job.status = 'QUEUED'
  else if (s === 'ERROR' || s === 'FAILED') job.status = 'FAILED'
  else job.status = s || 'QUEUED'

  job.progress = Number.isFinite(Number(job.progress)) ? Number(job.progress) : 0
  job.errorMessage = job.errorMessage || job.error || job.failure || null
  job.resultUrl = job.resultUrl || job.outputUrl || job.videoUrl || null
  job.finalVideoPath = job.finalVideoPath || job.outputPath || job.outputFile || null
  return job
}

// In-memory job store for now
const jobs = new Map()

function makeJob({ id, path = null, filename = null, contentType = null }) {
  const createdAt = new Date().toISOString()
  return {
    id,
    status: 'QUEUED',
    progress: 0,
    createdAt,
    path,
    filename,
    contentType,
  }
}

// Get single job by id or list all
router.get('/', async (req, res) => {
  try {
    const qid = req.query.id || null
    if (qid) {
      if (db) {
        const snap = await db.collection('jobs').doc(qid).get()
        if (snap && snap.exists) {
          let job = snap.data()
          try { job = await attachSignedUrlsToJob(job, 30) } catch (e) {}
          job = normalizeJobRecord(job)
          return res.status(200).json({ ok: true, job })
        }
      }
      let job = jobs.get(qid) || null
      try { job = await attachSignedUrlsToJob(job, 30) } catch (e) {}
      job = normalizeJobRecord(job)
      return res.status(200).json({ ok: true, job })
    }

    // list all — prefer Firestore collection if available
    if (db) {
      const snaps = await db.collection('jobs').orderBy('createdAt', 'desc').limit(100).get()
      let arr = []
      snaps.forEach(s => arr.push(s.data()))
      try { arr = await Promise.all(arr.map(j => attachSignedUrlsToJob(j, 30))) } catch (e) {}
      arr = arr.map(normalizeJobRecord)
      return res.status(200).json({ ok: true, jobs: arr, queued: listQueued() })
    }
    let arr = Array.from(jobs.values())
    try { arr = await Promise.all(arr.map(j => attachSignedUrlsToJob(j, 30))) } catch (e) {}
    arr = arr.map(normalizeJobRecord)
    return res.status(200).json({ ok: true, jobs: arr, queued: listQueued() })
  } catch (e) {
    console.error('[jobs] GET error', e)
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) })
  }
})

// Get single job by id path for backward compatibility
router.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' })
  try {
    if (db) {
      const snap = await db.collection('jobs').doc(id).get()
      if (snap && snap.exists) {
          let job = snap.data()
          try { job = await attachSignedUrlsToJob(job, 30) } catch (e) {}
          job = normalizeJobRecord(job)
          // Return a consistent, minimal job view for frontend
          const out = {
            id: job.id,
            status: job.status,
            progress: job.progress,
            errorMessage: job.errorMessage || null,
            resultUrl: job.resultUrl || job.outputUrl || null
          }
          return res.status(200).json({ ok: true, job: out })
        }
    }
    let job = jobs.get(id) || null
    try { job = await attachSignedUrlsToJob(job, 30) } catch (e) {}
    job = normalizeJobRecord(job)
    const out = {
      id: job.id,
      status: job.status,
      progress: job.progress,
      errorMessage: job.errorMessage || null,
      resultUrl: job.resultUrl || job.outputUrl || null
    }
    return res.status(200).json({ ok: true, job: out })
  } catch (e) {
    console.error('[jobs] GET /:id error', e)
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) })
  }
})

// Download processed MP4 for a job. Serves local `renders/<jobId>.mp4` when present,
// otherwise streams the file from the configured storage bucket using the
// job's `finalVideoPath` (or the guessed `outputs/<jobId>/final.mp4`). This
// endpoint is safe for production: it streams from disk or GCS and returns
// `Content-Disposition: attachment` so browsers download the MP4.
router.get('/:id/download', async (req, res) => {
  const id = req.params.id
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' })
  try {
    // Determine expected output path from job doc or guess
    let filePath = null
    if (db) {
      const snap = await db.collection('jobs').doc(id).get()
      if (snap && snap.exists) {
        const job = snap.data()
        filePath = job && (job.outputPath || job.outputFile || job.finalVideoPath || null)
      }
    }

    if (!filePath) filePath = `results/${id}/output.mp4`

    try {
      const url = await getSignedUrlForPath(filePath, 60)
      return res.redirect(url)
    } catch (err) {
      // If object not found, surface 404 with expected path
      const msg = err && err.message ? err.message : String(err)
      if (msg.includes('Storage object not found')) {
        return res.status(404).json({ error: 'Output video not found', expected: filePath })
      }
      console.error('[jobs:download] failed to generate signed URL', err && (err.stack || err.message || err))
      return res.status(500).json({ error: 'download failed' })
    }
  } catch (e) {
    console.error('[jobs:download] error', e && (e.stack || e.message || e))
    return res.status(500).json({ ok: false, error: 'Download failed' })
  }
})

// Retry endpoint to re-enqueue a job
router.post('/:id/retry', async (req, res) => {
  const id = req.params.id
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' })
  try {
    if (!db) return res.status(500).json({ ok: false, error: 'Firestore not available' })
    const snap = await db.collection('jobs').doc(id).get()
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'Job not found' })
    const data = snap.data()
    await db.collection('jobs').doc(id).set({ status: 'QUEUED', progress: 0, message: 'Re-queued', updatedAt: Date.now() }, { merge: true })
    reenqueue(id, data.inputSpec || {})
    console.log('Re-enqueued', id)
    return res.status(200).json({ ok: true, jobId: id })
  } catch (e) {
    console.error('[jobs] retry error', e)
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) })
  }
})

// Create a job
router.post('/', async (req, res) => {
  try {
    console.log('[jobs] POST incoming')
    const body = req.body || {}
    const { storagePath, gsUri, downloadURL, filename, contentType } = body
    const smartZoom = body.smartZoom || null

    // REQUIRE storagePath to match frontend behavior
    if (!storagePath) {
      return res.status(400).json({ ok: false, error: 'Missing required field: storagePath' })
    }

    const jobId = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.floor(Math.random() * 100000)}`

    // Build canonical gsUri when possible
    const computedGs = gsUri || (storagePath && (admin.getBucketName ? `gs://${admin.getBucketName()}/${storagePath}` : null)) || null

    const inputSpec = { storagePath }
    if (computedGs) inputSpec.gsUri = computedGs
    if (downloadURL) inputSpec.downloadURL = downloadURL

    // Persist job to Firestore
    try {
      const now = admin.firestore.FieldValue.serverTimestamp()
      await db.collection('jobs').doc(jobId).set({
        id: jobId,
        uid: null,
        status: 'QUEUED',
        progress: 0,
        createdAt: now,
        updatedAt: now,
        inputSpec,
        filename: filename || null,
        contentType: contentType || null,
        errorMessage: null,
        result: null,
      }, { merge: true })
    } catch (e) {
      console.error('[jobs] failed to persist job to Firestore', e && (e.message || e))
      return res.status(500).json({ ok: false, error: 'Failed to persist job' })
    }

    // Attach to in-memory jobs map for local visibility and enqueue
    const job = makeJob({ id: jobId, path: computedGs || storagePath, filename, contentType })
    job.inputSpec = inputSpec
    jobs.set(jobId, job)

    console.log('[jobs] create', { jobId, storagePath, downloadURL, filename, contentType, smartZoom })

    try {
      enqueue(jobId, inputSpec)
      console.log(`[jobs] enqueued ${jobId}`)
    } catch (e) {
      console.error('[jobs] failed to enqueue', e && (e.message || e))
    }

    // Return consistent API contract to frontend
    return res.status(201).json({ id: jobId, status: 'QUEUED' })
  } catch (err) {
    console.error('[jobs] POST error', err && (err.stack || err.message || err))
    return res.status(500).json({ ok: false, errorMessage: 'Internal server error' })
  }
})

// Start a job immediately (transition to PROCESSING and enqueue)
router.post('/:id/start', async (req, res) => {
  const id = req.params.id
  if (!id) return res.status(400).json({ ok: false, errorMessage: 'Missing id' })
  try {
    if (!db) return res.status(500).json({ ok: false, errorMessage: 'Firestore not available' })
    const snap = await db.collection('jobs').doc(id).get()
    if (!snap.exists) return res.status(404).json({ ok: false, errorMessage: 'Job not found' })
    const data = snap.data() || {}
    await db.collection('jobs').doc(id).set({ status: 'PROCESSING', progress: 0, message: 'Manually started', updatedAt: Date.now() }, { merge: true })
    try { enqueue(id, data.inputSpec || {}) } catch (e) { console.error('[jobs] failed to enqueue on start', e) }
    console.log('[jobs] start invoked for', id)
    return res.status(200).json({ id, status: 'PROCESSING' })
  } catch (e) {
    console.error('[jobs] start error', e)
    return res.status(500).json({ ok: false, errorMessage: e && e.message ? e.message : String(e) })
  }
})

module.exports = router
