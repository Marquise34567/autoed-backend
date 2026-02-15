const express = require('express')
const router = express.Router()

router.get('/', (req, res) => {
  try {
    // Placeholder; return basic JSON. Frontend may require auth — update as needed.
    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('API ERROR:', err)
    console.error('STACK:', err && err.stack)
    return res.status(500).json({ ok: false, message: err && err.message, stack: err && err.stack })
  }
})

module.exports = router
