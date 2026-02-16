const express = require('express')
const router = express.Router()

<<<<<<< HEAD
const { admin, bucket } = require('../services/firebaseAdmin')
=======
const admin = require('../services/firebaseAdmin')

function sanitizeFilename(name) {
  if (!name) return 'file'
  return String(name).replace(/[^a-zA-Z0-9.\-_ ]/g, '_').slice(0, 240)
}
>>>>>>> 690ef44 (fix(firebase): centralize admin init + export db/bucket; update routes)

router.post('/', async (req, res) => {
  try {
    const body = req.body || {}
    const fileName = body.fileName || body.file_name || null
    const contentType = body.contentType || body.content_type || null

    if (!fileName) return res.status(400).json({ ok: false, error: 'Missing fileName' })
    if (!contentType) return res.status(400).json({ ok: false, error: 'Missing contentType' })

    // Resolve bucket from services/firebaseAdmin
    let useBucket = bucket
    try {
      if (!useBucket && admin && admin.storage) useBucket = admin.storage().bucket()
    } catch (e) { useBucket = null }

    try {
      console.log('[upload-url] resolved bucket:', bucket && (bucket.name || bucket.id || '<unknown>'))
      console.log('[upload-url] filename:', fileName)
      console.log('[upload-url] contentType:', contentType)
    } catch (e) {
      console.warn('[upload-url] debug log failed', e)
    }

    if (!useBucket) return res.status(500).json({ ok: false, error: 'Storage bucket not configured' })

    const storagePath = `uploads/${Date.now()}-${fileName}`
    const file = useBucket.file(storagePath)

    try {
      // Do not sign Content-Type header (clients may set it freely)
      const [uploadUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: new Date(Date.now() + 15 * 60 * 1000),
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
