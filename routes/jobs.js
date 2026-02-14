const express = require('express')
const crypto = require('crypto')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const admin = require('../utils/firebaseAdmin')
const db = admin.db

async function processVideo(jobId, inputPath) {
  console.log('Processing started:', jobId)
  try {
    // Mark processing started
    await db.collection('jobs').doc(jobId).set({ status: 'processing', progress: 10, message: 'Processing started', updatedAt: Date.now() }, { merge: true })

    const bucket = admin.getBucket()

    // Download to /tmp/uploads
    const tmpDir = path.resolve(process.cwd(), 'tmp', 'uploads')
    fs.mkdirSync(tmpDir, { recursive: true })
    const safeName = path.basename(inputPath).replace(/[^a-z0-9.\-_]/gi, '_')
    const localIn = path.resolve(tmpDir, `${jobId}-${safeName}`)
    console.log(`[jobs:${jobId}] Downloading ${inputPath} -> ${localIn}`)
    await bucket.file(inputPath).download({ destination: localIn })
    console.log('Video downloaded')
    await db.collection('jobs').doc(jobId).set({ progress: 20, message: 'Video downloaded', updatedAt: Date.now() }, { merge: true })

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
  let job = jobs.get(id)
  if (!job) {
    job = makeJob({ id })
    jobs.set(id, job)
    console.log(`[jobs] created ${id} path=${job.path}`)
  }
  return res.status(200).json({ ok: true, job })
})

// Create a job
router.post('/', (req, res) => {
  try {
    // Debug logging to help verify incoming requests (one-time per deploy is fine)
    console.log('[jobs] req.headers content-type:', req.headers['content-type'])
    console.log('[jobs] req.body typeof:', typeof req.body, 'body:', req.body)

    const body = req.body || {}
    const { path: objectPath, filename, contentType } = body

    // Validate and echo what was received for clearer errors
    if (!path || !filename || !contentType) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: path, filename, contentType', received: { path, filename, contentType } })
    }

    const jobId = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.floor(Math.random() * 100000)}`
    const job = makeJob({ id: jobId, path: objectPath, filename, contentType })
    jobs.set(jobId, job)
    console.log(`[jobs] created ${jobId} path=${objectPath}`)

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
          objectPathOriginal: objectPath,
          filename: filename,
          contentType: contentType,
          logs: [`Job created via Express POST`],
        }, { merge: true })
      } catch (e) {
        console.error('[jobs] failed to persist job to Firestore', e)
      }
    })()

    // Schedule processing without blocking response
    job.inputPath = objectPath
    setImmediate(() => {
      processVideo(jobId, job.inputPath).catch((e) => {
        console.error(`[jobs:${jobId}] processVideo uncaught error:`, e)
        try { db.collection('jobs').doc(jobId).set({ status: 'failed', error: e && (e.message || String(e)), updatedAt: Date.now() }, { merge: true }) } catch (_) {}
      })
    })

    return res.status(200).json(job)
  } catch (err) {
    console.error('[jobs] POST error', err && err.message ? err.message : err)
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : 'Internal error' })
  }
})

module.exports = router
