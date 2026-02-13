const express = require('express')
try {
  module.exports = require('./jobs/route')
} catch (e) {
  console.warn('routes/jobs.js: underlying module missing, providing fallback router', e && e.message)
  const router = express.Router()
  router.get('/', (req, res) => res.status(200).json({ ok: true, jobs: [] }))
  module.exports = router
}
