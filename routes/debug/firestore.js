const express = require('express')
const router = express.Router()
const { admin, db, getBucketName } = require('../../services/firebaseAdmin')

// Read-only Firestore debug: list top-level collections to prove DB access.
router.get('/firestore', async (req, res) => {
  try {
    const collections = await db.listCollections()
    const names = collections && collections.map ? collections.map(c => c.id) : []
    const projectId = (admin && admin.app && admin.app().options && admin.app().options.projectId) || process.env.FIREBASE_PROJECT_ID || null
    return res.json({ ok: true, projectId, bucket: getBucketName && getBucketName(), firestoreOk: true, collections: names.slice(0, 10) })
  } catch (err) {
    console.error('FIRESTORE_DEBUG_ERROR', err)
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) })
  }
})

module.exports = router
