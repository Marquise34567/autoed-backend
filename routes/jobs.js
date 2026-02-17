const express = require('express')
const crypto = require('crypto')
const router = express.Router()
// note: heavy processing moved to worker; keep route lightweight
const admin = require('../services/firebaseAdmin')
const db = (admin && admin.db) || null
const { getSignedUrlForPath, attachSignedUrlsToJob } = require('../utils/storageSignedUrl')
const { enqueue, reenqueue, listQueued } = require('../services/worker/queue')
// db is defined above

function jlog(event, meta = {}) {
  const base = { ts: new Date().toISOString(), event, workerId: process.env.RAILWAY_SERVICE_NAME || require('os').hostname() }
  try { console.log(JSON.stringify(Object.assign(base, meta))) } catch (e) { console.log(base, meta) }
}
// (imports and db defined above)

// The heavy processing implementation used to live here; all processing
// now runs in the worker (`services/worker/processJob.js`). Keeping this file
// lightweight prevents accidental blocking of the HTTP request lifecycle.

function normalizeJobRecord(raw) {
  if (!raw) return null
  const job = { ...raw }
  // normalize status strings
  const s = (job.status || job.state || '').toString().toLowerCase()
  if (s === 'done' || s === 'completed' || s === 'complete') job.status = 'completed'
  else if (s === 'processing') job.status = 'processing'
  else if (s === 'queued') job.status = 'queued'
  else if (s === 'error' || s === 'failed') job.status = 'failed'
  else job.status = s || 'queued'

  job.progress = Number.isFinite(Number(job.progress)) ? Number(job.progress) : 0
  job.errorMessage = job.errorMessage || job.error || job.failure || null
  job.resultUrl = job.resultUrl || job.outputUrl || job.videoUrl || null
  job.finalVideoPath = job.finalVideoPath || job.outputPath || job.outputFile || null
  return job
}

function parseGsUri(gsUri) {
  if (!gsUri || typeof gsUri !== 'string') return null
  if (!gsUri.startsWith('gs://')) return null
  const noPrefix = gsUri.slice('gs://'.length)
  const firstSlash = noPrefix.indexOf('/')
  if (firstSlash === -1) return { bucket: noPrefix, path: '' }
  return { bucket: noPrefix.slice(0, firstSlash), path: noPrefix.slice(firstSlash + 1) }
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

// Get single job by id or list all
router.get('/', async (req, res) => {
  try {
    const qid = req.query.id || null
    if (qid) {
      if (db) {
        const snap = await db.collection('jobs').doc(qid).get()
        if (snap && snap.exists) {
            let job = snap.data() || {}
            console.log('[jobs] GET', qid, 'data:', job)
            // Do NOT generate signed URLs during the status request. Return stored fields only.
          // Normalize but return canonical fields explicitly to avoid HTTP codes leaking into `status`
          const norm = normalizeJobRecord(job)
          // Enforce: a job must not be considered completed without a resultUrl
          if (norm.status === 'completed' && !norm.resultUrl) {
            try {
              await db.collection('jobs').doc(qid).set({ status: 'failed', errorMessage: 'Legacy job missing resultUrl', progress: 100, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
            } catch (e) { console.warn('[jobs] failed to mark legacy completed job as failed', e && (e.stack || e.message || e)) }
            return res.status(200).json({ ok: true, jobId: norm.id || qid, status: 'failed', progress: 100, resultUrl: null, finalVideoPath: null, errorMessage: 'Legacy job missing resultUrl', updatedAt: norm.updatedAt || null })
          }
          // If job completed and has an outputPath, attach a signed download URL
          let downloadUrl = null
          const possibleOutput = (job && (job.outputPath || job.finalVideoPath || job.resultPath)) || null
          try {
            if (norm.status === 'completed' && possibleOutput) {
              downloadUrl = await getSignedUrlForPath(possibleOutput, 60)
            }
          } catch (e) { console.warn('[jobs] failed to generate signed URL for job GET', e && (e.message || e)) }

          const out = {
            ok: true,
            jobId: norm.id || qid,
            status: norm.status || 'queued',
            progress: Number.isFinite(Number(norm.progress)) ? Number(norm.progress) : null,
            resultUrl: downloadUrl || norm.resultUrl || null,
            finalVideoPath: norm.finalVideoPath || null,
            errorMessage: norm.errorMessage || norm.error || null,
            error: norm.errorMessage || norm.error || null,
            updatedAt: norm.updatedAt || null
          }
          return res.status(200).json(out)
        }
      }
      let job = jobs.get(qid) || null
      try { job = await attachSignedUrlsToJob(job, 30) } catch (e) {}
      job = normalizeJobRecord(job)
      const out = {
        ok: true,
        jobId: job && job.id || qid,
        status: job && job.status || 'queued',
        progress: job && Number.isFinite(Number(job.progress)) ? Number(job.progress) : null,
        resultUrl: job && job.resultUrl || null,
        finalVideoPath: job && job.finalVideoPath || null,
        error: job && (job.errorMessage || job.error) || null,
        updatedAt: job && job.updatedAt || null
      }
      return res.status(200).json(out)
    }

    // list all — prefer Firestore collection if available
    if (db) {
        // Query shape: orderBy createdAt desc limit 100. If callers filter by userId, prefer client-side sorting to avoid composite indexes.
        console.log('[jobs] query shape: collection=jobs orderBy=createdAt DESC limit=100')
        const snaps = await db.collection('jobs').orderBy('createdAt', 'desc').limit(100).get()
      let arr = []
      snaps.forEach(s => arr.push(s.data()))
      // Do NOT attach signed URLs in the list endpoint. Return stored fields only.
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
          // Do NOT attach signed URLs here; status endpoints return stored fields only.
          job = normalizeJobRecord(job)
          // If a legacy job reports completed but has no resultUrl, mark failed
          if (job.status === 'completed' && !job.resultUrl) {
            try { await db.collection('jobs').doc(id).set({ status: 'failed', errorMessage: 'Legacy job missing resultUrl', progress: 100, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }) } catch (e) { console.warn('[jobs] failed to mark legacy completed job as failed', e && (e.stack || e.message || e)) }
            const outFail = { id: job.id, status: 'failed', progress: 100, errorMessage: 'Legacy job missing resultUrl', resultUrl: null }
            return res.status(200).json({ ok: true, job: outFail })
          }
          // Return a consistent, minimal job view for frontend
          let downloadUrl = null
          const possibleOutput = job && (job.outputPath || job.finalVideoPath || job.resultPath) || null
          try {
            if (job.status === 'completed' && possibleOutput) {
              downloadUrl = await getSignedUrlForPath(possibleOutput, 60)
            }
          } catch (e) { console.warn('[jobs] failed to generate signed URL for job GET/:id', e && (e.message || e)) }

          const out = {
            id: job.id,
            status: job.status,
            progress: job.progress,
            errorMessage: job.errorMessage || null,
            resultUrl: downloadUrl || job.resultUrl || job.outputUrl || null
          }
          return res.status(200).json({ ok: true, job: out })
        }
    }
    let job = jobs.get(id) || null
    // Do not attach signed URLs for in-memory jobs either; return stored fields only
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
    let job = null
    if (db) {
      const snap = await db.collection('jobs').doc(id).get()
      if (snap && snap.exists) {
        job = snap.data()
        filePath = job && (job.outputPath || job.outputFile || job.finalVideoPath || null)
      }
    }

    // Only allow download when an explicit uploaded output path is present.
    if (!filePath) {
      // If the job exists but has failed, surface the real failure message.
      if (job && job.status === 'failed') {
        const em = job.errorMessage || job.error || 'Processing failed'
        return res.status(400).json({ ok: false, error: 'job_failed', errorMessage: em })
      }
      return res.status(409).json({ ok: false, status: 'not_ready', message: 'Output not available yet', expectedGuess: `results/${id}/output.mp4` })
    }

    try {
      const url = await getSignedUrlForPath(filePath, 60)
      return res.redirect(url)
    } catch (err) {
      const msg = err && err.message ? err.message : String(err)
      if (msg.includes('Storage object not found')) {
        return res.status(404).json({ ok: false, error: 'Output video not found', expected: filePath })
      }
      console.error('[jobs:download] failed to generate signed URL', err && (err.stack || err.message || err))
      return res.status(500).json({ ok: false, error: 'download_failed' })
    }
  } catch (e) {
    console.error('[jobs:download] error', e && (e.stack || e.message || e))
    return res.status(500).json({ ok: false, error: 'Download failed' })
  }
})

// Dedicated endpoint to fetch a signed output URL only when the output file exists.
router.get('/:id/output-url', async (req, res) => {
  const id = req.params.id
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' })
  try {
    if (!db) return res.status(500).json({ ok: false, error: 'Firestore not available' })
    const snap = await db.collection('jobs').doc(id).get()
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'Job not found' })
    const job = snap.data() || {}
    // Prefer explicit output references. Support either outputGsUri (gs://...) or outputBucket+outputPath.
    let ref = null
    if (job.outputGsUri && job.outputGsUri.startsWith && job.outputGsUri.startsWith('gs://')) {
      ref = parseGsUri(job.outputGsUri)
    } else if (job.outputBucket && job.outputPath) {
      ref = { bucket: job.outputBucket, path: job.outputPath }
    } else if (job.outputPath) {
      const envBucket = process.env.FIREBASE_STORAGE_BUCKET ? String(process.env.FIREBASE_STORAGE_BUCKET).replace(/^gs:\/\//i, '').trim() : null
      ref = { bucket: envBucket, path: job.outputPath }
    }

    if (!ref || !ref.bucket || !ref.path) {
      console.log('[output-url] jobId=' + id + ' missing output ref -> not_ready')
      return res.status(409).json({ status: 'not_ready', message: 'Output not available yet', jobId: id, phase: job.phase || job.status || null })
    }

    console.log('[output-url] jobId=' + id + ' checking bucket=' + ref.bucket + ' path=' + ref.path)
    try {
      // Verify the object exists before attempting to sign
      const file = admin.storage().bucket(ref.bucket).file(ref.path)
      const [exists] = await file.exists()
      if (!exists) {
        console.log('[output-url] jobId=' + id + ' output not found in bucket')
        return res.status(404).json({ ok: false, error: 'output_not_found', bucket: ref.bucket, path: ref.path })
      }

      const url = await getSignedUrlForPath(ref.path, 15, ref.bucket)
      const expiresAt = Date.now() + (15 * 60 * 1000)
      console.log('[output-url] jobId=' + id + ' signed url generated')
      return res.status(200).json({ ok: true, url, expiresAt, bucket: ref.bucket, path: ref.path })
    } catch (e) {
      const msg = e && e.message ? e.message : String(e)
      console.error('[output-url] jobId=' + id + ' error generating signed url', e && (e.stack || e.message || e))
      if (msg.includes('Storage object not found') || msg.includes('Output file missing')) {
        return res.status(409).json({ status: 'not_ready', message: 'Output not uploaded yet', jobId: id, phase: job.phase || job.status || null })
      }
      return res.status(500).json({ ok: false, error: 'failed_to_generate_signed_url' })
    }
  } catch (e) {
    console.error('[output-url] error', e && (e.stack || e.message || e))
    return res.status(500).json({ ok: false, error: 'internal_error' })
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
    await db.collection('jobs').doc(id).set({ status: 'queued', progress: 0, message: 'Re-queued', updatedAt: Date.now() }, { merge: true })
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
    jlog('job_post_incoming')

    // Basic user validation: prefer explicit userId in body, otherwise verify Bearer token to extract Firebase UID
    const body = req.body || {}
    const authHeader = req.headers && req.headers.authorization
    let userId = body.userId || null
    // If Authorization is a Bearer token, verify with Firebase Admin to extract UID
    if (!userId && authHeader) {
      try {
        const token = authHeader && authHeader.startsWith && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
        if (admin && admin.auth && typeof admin.auth === 'function') {
          const decoded = await admin.auth().verifyIdToken(token)
          if (decoded && decoded.uid) userId = decoded.uid
        }
      } catch (e) {
        console.warn('[jobs] failed to verify auth token, falling back to provided userId/text', e && (e.message || e))
      }
    }
    if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' })

    if (!db || !admin) {
      console.error('[jobs] firebaseAdmin missing', { hasDb: !!db, hasAdmin: !!admin })
      return res.status(500).json({ ok: false, error: 'firebase_admin_missing' })
    }

    const { storagePath, gsUri, downloadURL, filename, contentType } = body

    if (!storagePath) return res.status(400).json({ ok: false, error: 'Missing required field: storagePath' })

    const jobId = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.floor(Math.random() * 100000)}`

    // Build canonical gsUri when possible
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET ? String(process.env.FIREBASE_STORAGE_BUCKET).replace(/^gs:\/\//i, '').trim() : null
    const computedGs = gsUri || (storagePath && bucketName ? `gs://${bucketName}/${storagePath}` : null) || null

    const inputSpec = { storagePath }
    if (computedGs) inputSpec.gsUri = computedGs
    if (downloadURL) inputSpec.downloadURL = downloadURL

    // Persist queued job document and return immediately (no heavy work)
    try {
      const now = admin.firestore.FieldValue.serverTimestamp()
      await db.collection('jobs').doc(jobId).set({
        id: jobId,
        userId: userId,
        status: 'queued',
        phase: 'QUEUED',
        progress: 0,
        createdAt: now,
        updatedAt: now,
        // canonical input field for worker
        inputPath: storagePath,
        input: inputSpec,
        // placeholders for outputs
        outputPath: null,
        resultUrl: null,
        error: null,
        message: null,
      }, { merge: true })
    } catch (err) {
      console.error('[jobs] JOB_PERSIST_ERROR', err && (err.stack || err.message || err))
      return res.status(500).json({ ok: false, error: 'job create failed' })
    }

    // Enqueue for worker (non-blocking). Use existing enqueue; it's synchronous so await a resolved promise.
    try {
      enqueue(jobId, inputSpec)
    } catch (e) {
      console.error('[jobs] enqueue failed', e && (e.stack || e.message || e))
      // Even if enqueue fails, return error so caller can retry
      return res.status(500).json({ ok: false, error: 'enqueue_failed' })
    }

    return res.status(200).json({ ok: true, jobId })
  } catch (err) {
    console.error('[jobs] POST error', err && (err.stack || err.message || err))
    return res.status(500).json({ error: 'job create failed' })
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
    await db.collection('jobs').doc(id).set({ status: 'processing', progress: 0, message: 'Manually started', updatedAt: Date.now() }, { merge: true })
    try { enqueue(id, data.inputSpec || {}) } catch (e) { console.error('[jobs] failed to enqueue on start', e) }
    console.log('[jobs] start invoked for', id)
    return res.status(200).json({ id, status: 'processing' })
  } catch (e) {
    console.error('[jobs] start error', e)
    return res.status(500).json({ ok: false, errorMessage: e && e.message ? e.message : String(e) })
  }
})

module.exports = router
