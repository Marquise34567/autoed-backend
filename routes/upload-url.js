const express = require('express')
const mimeLib = require('mime-types')
const router = express.Router()

// Try to reuse Firebase admin storage if available
let admin = null
try {
  admin = require('../utils/firebaseAdmin')
} catch (e) {
  admin = null
}

router.post('/', async (req, res) => {
  try {
    const { filename, contentType, mime } = req.body || {}
    const ct = contentType || mime || mimeLib.lookup(filename) || null
    if (!filename || !ct) {
      return res.status(400).json({ ok: false, error: 'Missing filename or contentType' })
    }

    if (!admin || !admin.storage) {
      return res.status(500).json({ ok: false, error: 'Firebase admin not configured' })
    }

    try {
      const bucketName = process.env.FIREBASE_STORAGE_BUCKET || undefined
      const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket()

      // generate unique path
      const safeFilename = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_')
      const destPath = `uploads/${Date.now()}-${safeFilename}`

      const file = bucket.file(destPath)
      const expires = Date.now() + 15 * 60 * 1000 // 15 minutes

      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires,
        contentType: ct,
      })

      return res.json({ ok: true, uploadUrl: url, path: destPath })
    } catch (err) {
      // Do not log private keys or sensitive envs
      console.error('[upload-url] firebase error:', err && err.message)
      return res.status(500).json({ ok: false, error: err && err.message ? err.message : 'Firebase error' })
    }
  } catch (err) {
    console.error('[upload-url] handler error', err && (err.stack || err.message || err))
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : 'Internal server error' })
  }
})

module.exports = router
