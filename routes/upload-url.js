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
  const requestId = Date.now() + ':' + Math.floor(Math.random() * 10000)
  try {
    const { filename, contentType, mime } = req.body || {}
    console.log(`[upload-url:${requestId}] request body:`, { filename, contentType })
    const ct = contentType || mime || mimeLib.lookup(filename) || null
    if (!filename || !ct) {
      return res.status(400).json({ error: 'Missing filename or contentType', details: 'Provide filename and contentType in JSON body' })
    }

    if (!admin || !admin.storage) {
      console.error(`[upload-url:${requestId}] Firebase admin not configured`)
      return res.status(500).json({ error: 'Firebase admin not configured' })
    }

    try {
      const bucketName = process.env.FIREBASE_STORAGE_BUCKET || undefined
      const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket()

      // generate unique, safe path
      const safeFilename = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_')
      const destPath = `uploads/${Date.now()}-${safeFilename}`

      const file = bucket.file(destPath)
      // Use a Date instance for expires to be explicit
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

      const [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: expiresAt,
        contentType: ct,
      })

      // Confirm signedUrl exists for frontend expectations
      console.log(`[upload-url:${requestId}] signedUrl generated:`, !!signedUrl, { path: destPath, bucket: bucket.name })
      if (!signedUrl || typeof signedUrl !== 'string') {
        console.error(`[upload-url:${requestId}] signedUrl is invalid`, { path: destPath, bucket: bucket.name, contentType: ct })
        return res.status(500).json({ error: 'SIGNED_URL_FAILED', details: 'signedUrl undefined' })
      }

      // Return consistent contract required by frontend
      return res.status(200).json({ signedUrl, path: destPath, publicUrl: null })
    } catch (err) {
      // Log non-sensitive error info
      console.error(`[upload-url:${requestId}] firebase error:`, err && (err.message || err))
      return res.status(500).json({ error: 'SIGNED_URL_FAILED', details: err && err.message ? err.message : String(err) })
    }
  } catch (err) {
    console.error(`[upload-url:${requestId}] handler error`, err && (err.stack || err.message || err))
    return res.status(500).json({ error: err && err.message ? err.message : 'Internal server error' })
  }
})

// Preflight handled globally by CORS middleware

module.exports = router
