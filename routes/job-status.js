const express = require('express')
try {
  module.exports = require('./job-status/route')
} catch (e) {
  console.warn('routes/job-status.js: underlying module missing, providing fallback router', e && e.message)
  const router = express.Router()
  router.get('/', (req, res) => res.status(200).json({ ok: true, status: [] }))
  module.exports = router
}
