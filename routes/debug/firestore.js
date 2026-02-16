const express = require('express')
const router = express.Router()
const { admin, db, getBucketName } = require('../../services/firebaseAdmin')

// Read-only Firestore debug: list top-level collections to prove DB access.
router.get('/firestore', async (req, res) => {
  try {
    const collections = await db.listCollections()
    const names = collections && collections.map ? collections.map(c => c.id) : []
    const projectId = (admin && admin.app && admin.app().options && admin.app().options.projectId) || process.env.FIREBASE_PROJECT_ID || null
    // Perform a tiny write test to verify write permissions
    let canWrite = false
    try {
      const pingRef = db.collection('_debug').doc(`ping-${Date.now()}`)
      await pingRef.set({ ts: admin.firestore.FieldValue.serverTimestamp(), ok: true })
      canWrite = true
    } catch (we) {
      console.warn('FIRESTORE_WRITE_TEST_FAILED', we && (we.message || we))
      canWrite = false
    }
    return res.json({ ok: true, projectId, bucket: getBucketName && getBucketName(), firestoreOk: true, canWrite, collections: names.slice(0, 10) })
  } catch (err) {
    console.error('FIRESTORE_DEBUG_ERROR', err)
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) })
  }
})

// Expose a jobsQuery probe that mirrors the worker's query
router.get('/jobsQuery', async (req, res) => {
  try {
    if (!db) return res.status(500).json({ ok: false, error: 'Firestore not available' })
    const q = await db.collection('jobs').where('status', '==', 'queued').limit(20).get()
    const ids = q.empty ? [] : q.docs.map(d => d.id)
    return res.json({ ok: true, queuedCount: ids.length, sampleIds: ids.slice(0, 10) })
  } catch (err) {
    console.error('JOBSQUERY_DEBUG_ERROR', err)
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) })
  }
})

module.exports = router
