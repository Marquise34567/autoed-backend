const express = require('express')
const mimeLib = require('mime-types')
const router = express.Router()

// Helper: initialize admin from utils (handles service account envs)
let admin = null
try {
  admin = require('../utils/firebaseAdmin')
} catch (e) {
  admin = null
}

/*
  Test with curl:
  curl -X POST https://your-backend.example.com/api/upload-url \
    -H "Content-Type: application/json" \
    -d '{"filename":"video.mp4","contentType":"video/mp4"}'

  Response: { ok:true, signedUrl:"<PUT_URL>", path:"uploads/<ts>-video.mp4", bucket:"<bucket-name>" }
*/

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

      // generate unique, safe path
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

      return res.json({ ok: true, signedUrl: url, path: destPath, bucket: bucket.name })
    } catch (err) {
      // Log non-sensitive error info
      console.error('[upload-url] firebase error:', err && (err.message || err))
      return res.status(500).json({ ok: false, error: 'Failed to generate signed URL', details: err && err.message ? err.message : String(err) })
    }
  } catch (err) {
    console.error('[upload-url] handler error', err && (err.stack || err.message || err))
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : 'Internal server error' })
  }
})

// Ensure OPTIONS preflight is handled for CORS (explicitly allow headers used by client)
router.options('/', (req, res) => {
  res.set('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  res.set('Access-Control-Allow-Credentials', 'true')
  return res.sendStatus(204)
})

module.exports = router
