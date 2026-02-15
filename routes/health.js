const express = require('express')
const router = express.Router()

router.get('/', (req, res) => {
  res.status(200).json({ ok: true, service: 'backend', time: new Date().toISOString() })
})

module.exports = router
