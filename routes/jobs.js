const express = require('express')
const crypto = require('crypto')
const router = express.Router()

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
    const { path, filename, contentType } = body

    // Validate and echo what was received for clearer errors
    if (!path || !filename || !contentType) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: path, filename, contentType', received: { path, filename, contentType } })
    }

    const jobId = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.floor(Math.random() * 100000)}`
    const job = makeJob({ id: jobId, path, filename, contentType })
    jobs.set(jobId, job)
    console.log(`[jobs] created ${jobId} path=${path}`)
    return res.status(200).json({ ok: true, jobId, job })
  } catch (err) {
    console.error('[jobs] POST error', err && err.message ? err.message : err)
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : 'Internal error' })
  }
})

module.exports = router
