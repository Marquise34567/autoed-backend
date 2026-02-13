const express = require('express')
try {
  module.exports = require('./ping/route')
} catch (e) {
  console.warn('routes/ping.js: underlying module missing, providing fallback router', e && e.message)
  const router = express.Router()
  router.get('/', (req, res) => res.status(200).json({ ok: true, time: Date.now() }))
  module.exports = router
}
