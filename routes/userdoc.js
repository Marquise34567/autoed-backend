const express = require('express')
const router = express.Router()

router.get('/', (req, res) => {
  // Placeholder; return basic JSON. Frontend may require auth — update as needed.
  res.status(200).json({ ok: true })
})

module.exports = router
