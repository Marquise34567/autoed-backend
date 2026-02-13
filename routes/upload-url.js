const express = require('express')
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
    const { filename, contentType, mime, folder, path } = req.body || {}
    const ct = contentType || mime || null
    if (!filename || !ct) {
      return res.status(400).json({ ok: false, error: 'Missing filename or contentType' })
    }

    // If Firebase Storage is configured, try to create a signed upload URL
    try {
      const bucketName = process.env.FIREBASE_STORAGE_BUCKET || null
      if (admin && admin.storage && bucketName) {
        const bucket = admin.storage().bucket(bucketName)
        const destPath = (folder || path) ? `${folder || path}/${filename}`.replace(/\/g, '/') : filename
        const file = bucket.file(destPath)
        const expires = Date.now() + 15 * 60 * 1000 // 15 minutes
        const [url] = await file.getSignedUrl({
          action: 'write',
          expires,
          contentType: ct,
        })
        return res.json({ ok: true, uploadUrl: url, message: 'signed url (firebase)'} )
      }
    } catch (e) {
      console.warn('[upload-url] firebase signed url failed', e && e.message)
      // fallthrough to stub
    }

    // Fallback stub response
    return res.json({ ok: true, uploadUrl: null, message: 'stub - implement signed url next' })
  } catch (err) {
    console.error('[upload-url] handler error', err)
    return res.status(500).json({ ok: false, error: 'Internal server error' })
  }
})

module.exports = router
