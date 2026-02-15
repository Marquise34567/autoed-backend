const express = require('express')
const crypto = require('crypto')
const router = express.Router()

const admin = require('../utils/firebaseAdmin')

function sanitizeFilename(name) {
  if (!name) return 'file'
  return String(name).replace(/[^a-zA-Z0-9.\-_ ]/g, '_').slice(0, 240)
}

router.post('/', async (req, res) => {
  try {
    const body = req.body || {}
    const filename = body.filename || body.fileName || body.file_name || null
    const contentType = body.contentType || body.content_type || null
    const size = body.size || null

    if (!filename || !contentType) return res.status(400).json({ ok: false, error: 'Missing filename or contentType' })

    if (admin && admin._missingEnv) return res.status(500).json({ ok: false, error: 'Missing required env vars', missing: admin._missingEnv })

    const jobId = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.floor(Math.random()*100000)}`
    const safe = sanitizeFilename(filename)
    const storagePath = `uploads/anon/${jobId}/${safe}`

    // Resolve bucket
    let bucket = null
    try {
      if (admin && typeof admin.getBucket === 'function') bucket = admin.getBucket()
      else if (admin && admin.storage) bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET)
    } catch (e) {
      console.warn('[upload-url] failed to resolve bucket', e && e.message)
      bucket = null
    }

    if (!bucket) return res.status(500).json({ ok: false, error: 'Storage bucket not configured' })

    const file = bucket.file(storagePath)

    // Generate V4 signed URL for PUT and require contentType
    let uploadUrl
    try {
      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000,
        contentType: contentType,
      })
      uploadUrl = url
    } catch (e) {
      console.error('[upload-url] signed URL error', e && (e.stack || e.message || e))
      return res.status(500).json({ ok: false, error: 'Failed to generate signed URL', detail: e && e.message })
    }

    // Persist an initial job document so start can validate existence later
    try {
      if (admin && admin.db) {
        const now = admin.firestore.FieldValue.serverTimestamp()
        await admin.db.collection('jobs').doc(jobId).set({
          id: jobId,
          uid: null,
          status: 'created',
          progress: 0,
          createdAt: now,
          updatedAt: now,
          storagePath,
          filename: safe,
          contentType: contentType,
          size: size || null,
        }, { merge: true })
      }
    } catch (e) {
      console.warn('[upload-url] failed to persist job doc', e && e.message)
    }

    return res.status(200).json({ uploadUrl, storagePath, jobId })
  } catch (err) {
    console.error('[upload-url] error', err && (err.stack || err.message || err))
    return res.status(500).json({ ok: false, error: 'Server error', detail: err && err.message })
  }
})

module.exports = router
