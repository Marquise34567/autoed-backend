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

      // Confirm signedUrl exists for frontend expectations
      console.log('[upload-url] signedUrl generated:', !!url, { path: destPath, bucket: bucket.name })
      if (!url) {
        console.error('[upload-url] signedUrl is undefined', { path: destPath, bucket: bucket.name, contentType: ct })
        return res.status(500).json({ ok: false, error: 'SIGNED_URL_FAILED', details: 'signedUrl undefined' })
      }

      return res.json({ ok: true, signedUrl: url })
    } catch (err) {
      // Log non-sensitive error info
      console.error('[upload-url] firebase error:', err && (err.message || err))
      return res.status(500).json({ ok: false, error: 'SIGNED_URL_FAILED', details: err && err.message ? err.message : String(err) })
    }
  } catch (err) {
    console.error('[upload-url] handler error', err && (err.stack || err.message || err))
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : 'Internal server error' })
  }
})

// Preflight handled globally by CORS middleware

module.exports = router
