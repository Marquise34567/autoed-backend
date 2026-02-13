const express = require('express')
try {
  module.exports = require('./health/route')
} catch (e) {
  console.warn('routes/health.js: underlying module missing, providing fallback router', e && e.message)
  const router = express.Router()
  router.get('/', (req, res) => res.status(200).json({ status: 'ok' }))
  module.exports = router
}
