const express = require('express')
const router = express.Router()

const admin = require('../utils/firebaseAdmin')

router.post('/', async (req, res) => {
  try {
    const body = req.body || {}
    const fileName = body.fileName || body.file_name || null
    const contentType = body.contentType || body.content_type || null

    if (!fileName) return res.status(400).json({ ok: false, error: 'Missing fileName' })
    if (!contentType) return res.status(400).json({ ok: false, error: 'Missing contentType' })

    // Resolve bucket
    let bucket = null
    try {
      if (admin && typeof admin.getBucket === 'function') {
        bucket = admin.getBucket()
      } else if (admin && admin.storage) {
        bucket = admin.storage().bucket()
      }
    } catch (e) {
      bucket = null
    }

    if (!bucket) return res.status(500).json({ ok: false, error: 'Storage bucket not configured' })

    const storagePath = `uploads/${Date.now()}-${fileName}`
    const file = bucket.file(storagePath)

    try {
      const [uploadUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000,
        contentType,
      })

      console.log('[upload-url] generated', storagePath)
      return res.json({ uploadUrl, storagePath })
    } catch (e) {
      console.error('[upload-url] failed to generate signed URL', e && (e.stack || e.message || e))
      return res.status(500).json({ ok: false, error: 'Failed to generate upload URL', message: e && e.message })
    }
  } catch (err) {
    console.error('[upload-url] error', err && (err.stack || err.message || err))
    return res.status(500).json({ ok: false, error: 'Server error' })
  }
})

module.exports = router
