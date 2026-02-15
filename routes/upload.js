const express = require('express')

// This endpoint has been retired in favor of direct-to-storage signed URLs.
// Keep a small compatibility route that instructs clients to use `/api/upload-url`.
const router = express.Router()

router.post('/', (_req, res) => {
  return res.status(410).json({ ok: false, error: 'Server-side uploads removed. Use POST /api/upload-url to obtain a signed upload URL.' })
})

module.exports = router
