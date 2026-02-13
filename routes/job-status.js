const express = require('express')
const router = express.Router()

router.get('/', (req, res) => {
  const id = req.query.id || null
  res.status(200).json({ ok: true, id, status: 'unknown' })
})

module.exports = router
