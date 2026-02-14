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
    const { fileName, contentType, filename, mime, enforceContentType } = req.body || {}
    // support both fileName and filename param names
    const finalName = fileName || filename
    console.log(`[upload-url:${requestId}] request body:`, { fileName: finalName, contentType, enforceContentType })

    if (!finalName) {
      return res.status(400).json({ error: 'Missing fileName' })
    }

    const bucketName = process.env.FIREBASE_STORAGE_BUCKET
    if (!bucketName) {
      console.error(`[upload-url:${requestId}] FIREBASE_STORAGE_BUCKET is not set`)
      return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET is not set' })
    }

    const bucket = admin && admin.storage ? admin.storage().bucket(bucketName) : null
    if (!bucket) {
      console.error(`[upload-url:${requestId}] Firebase admin/storage not available`)
      return res.status(500).json({ error: 'Firebase admin/storage not available' })
    }

    // generate unique, safe path
    const safeFilename = String(finalName).replace(/[^a-zA-Z0-9._-]/g, '_')
    const destPath = `uploads/${Date.now()}-${safeFilename}`

    const file = bucket.file(destPath)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

    // Sign the URL. Do NOT bind Content-Type by default to avoid SignatureDoesNotMatch
    // If client explicitly requests enforcement via `enforceContentType` and provides
    // an exact `contentType`, include it in the signed URL options.
    const signOpts = { version: 'v4', action: 'write', expires: expiresAt }
    if (enforceContentType && contentType) signOpts.contentType = contentType
    const [uploadUrl] = await file.getSignedUrl(signOpts)

    console.log(`[upload-url:${requestId}] signedUrl generated:`, !!uploadUrl, { path: destPath, bucket: bucket.name })
    return res.status(200).json({ uploadUrl, filePath: destPath })
  } catch (err) {
    console.error(`[upload-url:${requestId}] handler error`, err && (err.stack || err.message || err))
    return res.status(500).json({ error: 'Failed to create signed URL' })
  }
})

// Preflight handled globally by CORS middleware

module.exports = router
