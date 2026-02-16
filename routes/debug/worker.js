const express = require('express')
const router = express.Router()
const worker = require('../../services/worker/worker')

// Read-only worker health endpoint
router.get('/worker', async (req, res) => {
  try {
    const status = worker.getStatus ? worker.getStatus() : { workerId: process.env.RAILWAY_SERVICE_NAME || require('os').hostname(), uptimeMs: 0, activeJobs: [], queuedCount: 0 }
    return res.json({ ok: true, ...status })
  } catch (err) {
    console.error('WORKER_DEBUG_ERROR', err)
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) })
  }
})

module.exports = router
