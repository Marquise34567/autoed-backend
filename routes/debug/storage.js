const express = require('express')
const router = express.Router()
const admin = require('../../services/firebaseAdmin')

// GET /api/debug/storage -> return configured bucket and project info
router.get('/', async (req, res) => {
  try {
    const appInstance = (admin && admin.appInstance) ? admin.appInstance : (admin && admin.app ? admin.app() : null)
    const projectIdUsed = (admin && admin.projectIdUsed) || (appInstance && appInstance.options && appInstance.options.projectId) || (process.env.FIREBASE_PROJECT_ID || null)
    const bucketEnv = process.env.FIREBASE_STORAGE_BUCKET || null
    const bucketUsedByAdmin = appInstance && appInstance.options && appInstance.options.storageBucket ? appInstance.options.storageBucket : (admin && typeof admin.getBucketName === 'function' ? admin.getBucketName() : null)
    return res.json({ ok: true, projectIdEnv: process.env.FIREBASE_PROJECT_ID || null, bucketEnv, bucketUsedByAdmin, projectIdUsed })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.get('/exists', async (req, res) => {
  try {
    const pathParam = String(req.query.path || '')
    if (!pathParam) return res.status(400).json({ ok: false, error: 'Missing path query param' })
    const appInstance = (admin && admin.appInstance) ? admin.appInstance : (admin && admin.app ? admin.app() : null)
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || (appInstance && appInstance.options && appInstance.options.storageBucket) || null
    if (!bucketName) return res.status(500).json({ ok: false, error: 'No storage bucket configured' })
    const bucket = admin.storage().bucket(bucketName)
    const file = bucket.file(pathParam)
    let exists = false
    try {
      const arr = await file.exists()
      exists = !!(arr && arr[0])
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Storage check failed: ' + (e && e.message) })
    }
    return res.json({ ok: true, bucket: bucketName, path: pathParam, exists })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

module.exports = router
