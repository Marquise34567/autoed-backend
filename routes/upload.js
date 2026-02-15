const express = require('express')
const multer = require('multer')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage() })

module.exports = router

router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' })

    const admin = require('../utils/firebaseAdmin')
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET
    if (!bucketName) return res.status(500).json({ ok: false, error: 'FIREBASE_STORAGE_BUCKET not configured' })

    const bucket = admin.storage().bucket(bucketName)
    const filename = req.file.originalname || `upload-${Date.now()}`
    const storagePath = `uploads/${Date.now()}-${filename}`

    const file = bucket.file(storagePath)

    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype || 'application/octet-stream',
      },
    })

    // Try to get a signed URL (1 hour). If it fails, return a storagePath only.
    let downloadUrl = null
    try {
      const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 60 * 60 * 1000 })
      downloadUrl = url
    } catch (e) {
      console.warn('[upload] failed to get signed url', e && e.message)
    }

    return res.json({ ok: true, storagePath, downloadUrl })
  } catch (err) {
    console.error('[upload] error', err && (err.stack || err.message || err))
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : 'Upload failed' })
  }
})
