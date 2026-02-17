const express = require('express')
const router = express.Router()
const { admin, db } = require('../../services/firebaseAdmin')

function fmtTs(v) {
  try {
    if (!v) return null
    if (v.toDate) return v.toDate().toISOString()
    if (v instanceof Date) return v.toISOString()
    return String(v)
  } catch (e) { return null }
}

router.get('/firestore', async (req, res) => {
  try {
    if (!db) return res.status(500).json({ ok: false, error: 'Firestore not available' })
    const appInstance = (admin && admin.appInstance) ? admin.appInstance : (admin && admin.app ? (admin.app && admin.app()) : null)
    const projectIdUsed = (admin && admin.projectIdUsed) || (appInstance && appInstance.options && appInstance.options.projectId) || (process.env.FIREBASE_PROJECT_ID || null)
    const env = {
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || null,
      GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || null,
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || null,
      FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET || null
    }
    const firebaseStorageBucket = env.FIREBASE_STORAGE_BUCKET || (appInstance && appInstance.options && appInstance.options.storageBucket) || null

    // tiny write test (non-fatal)
    let canWrite = false
    try {
      const pingRef = db.collection('_debug').doc(`ping-${Date.now()}`)
      await pingRef.set({ ts: admin.firestore.FieldValue.serverTimestamp(), ok: true })
      canWrite = true
    } catch (we) { canWrite = false }

    // queued jobs probe
    let queuedCount = 0
    let queuedIds = []
    let queuedSamples = []
    try {
      const queuedSnap = await db.collection('jobs').where('status', '==', 'queued').limit(10).get()
      queuedCount = queuedSnap.empty ? 0 : (queuedSnap.size || queuedSnap.docs.length)
      queuedIds = queuedSnap.empty ? [] : queuedSnap.docs.map(d => d.id)
      if (!queuedSnap.empty && queuedSnap.docs.length > 0) {
        queuedSamples = queuedSnap.docs.slice(0, 2).map(d => {
          const data = d.data() || {}
          return {
            id: d.id,
            status: data.status || null,
            phase: data.phase || null,
            createdAt: fmtTs(data.createdAt),
            updatedAt: fmtTs(data.updatedAt)
          }
        })
      }
    } catch (qe) {
      console.warn('FIRESTORE_QUEUED_PROBE_FAILED', qe && qe.message)
    }

    // recent jobs probe
    let recentJobs = []
    try {
      let recentSnap = null
      try {
        recentSnap = await db.collection('jobs').orderBy('createdAt', 'desc').limit(3).get()
      } catch (e) {
        recentSnap = await db.collection('jobs').limit(3).get()
      }
      if (recentSnap && !recentSnap.empty) {
        recentJobs = recentSnap.docs.map(d => {
          const data = d.data() || {}
          return { id: d.id, status: data.status || null, phase: data.phase || null, createdAt: fmtTs(data.createdAt), updatedAt: fmtTs(data.updatedAt) }
        })
      }
    } catch (re) {
      console.warn('FIRESTORE_RECENT_PROBE_FAILED', re && re.message)
    }

    const jobsChecks = {
      totalJobsSample: recentJobs,
      queuedCount,
      queuedIds
    }

    return res.json({ ok: true, projectIdUsed, env, firebaseStorageBucket, canWrite, jobsChecks })
  } catch (err) {
    console.error('FIRESTORE_DEBUG_ERROR', err && (err.stack || err.message || err))
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) })
  }
})

// GET /api/debug/job/:id — return doc and check storage existence for output path
router.get('/job/:id', async (req, res) => {
  try {
    if (!db) return res.status(500).json({ ok: false, error: 'Firestore not available' })
    const id = String(req.params.id || '')
    if (!id) return res.status(400).json({ ok: false, error: 'Missing job id' })
    const docRef = db.collection('jobs').doc(id)
    const snap = await docRef.get()
    const appInstance = (admin && admin.appInstance) ? admin.appInstance : (admin && admin.app ? (admin.app && admin.app()) : null)
    const projectIdUsed = (admin && admin.projectIdUsed) || (appInstance && appInstance.options && appInstance.options.projectId) || (process.env.FIREBASE_PROJECT_ID || null)
    const storageBucketName = process.env.FIREBASE_STORAGE_BUCKET || (appInstance && appInstance.options && appInstance.options.storageBucket) || null

    if (!snap.exists) {
      // try trimmed id as fallback
      const trimmed = id.trim()
      if (trimmed !== id) {
        try {
          const snap2 = await db.collection('jobs').doc(trimmed).get()
          if (snap2 && snap2.exists) {
            const data2 = snap2.data() || {}
            return res.json({ ok: true, projectIdUsed, id: trimmed, found: true, doc: data2 })
          }
        } catch (e) { /* ignore */ }
      }
      return res.json({ ok: true, projectIdUsed, id, found: false, doc: null })
    }
    const data = snap.data() || {}

    // determine candidate outputPath
    let outputPath = null
    const candidates = ['outputPath', 'resultPath', 'output.path', 'output.storagePath']
    const pickCandidates = () => {
      if (data.outputPath) return 'outputPath'
      if (data.resultPath) return 'resultPath'
      if (data.output && data.output.path) return 'output.path'
      if (data.output && data.output.storagePath) return 'output.storagePath'
      return null
    }
    const foundKey = pickCandidates()
    try {
      if (foundKey === 'outputPath') outputPath = data.outputPath
      else if (foundKey === 'resultPath') outputPath = data.resultPath
      else if (foundKey === 'output.path') outputPath = data.output && data.output.path
      else if (foundKey === 'output.storagePath') outputPath = data.output && data.output.storagePath
    } catch (e) { outputPath = null }

    let exists = null
    try {
      if (outputPath && storageBucketName && admin && admin.storage) {
        // normalize gs:// prefix
        let candidatePath = String(outputPath)
        if (candidatePath.startsWith('gs://')) {
          const parts = candidatePath.replace('gs://', '').split('/')
          if (parts.length > 1) {
            // if bucket is encoded in path, strip it
            parts.shift()
            candidatePath = parts.join('/')
          }
        }
        const bucket = admin.storage().bucket(storageBucketName)
        const file = bucket.file(candidatePath)
        const [e] = await file.exists()
        exists = !!e
      }
    } catch (se) {
      console.warn('STORAGE_EXISTS_CHECK_FAILED', se && se.message)
      exists = null
    }

    return res.json({ ok: true, projectIdUsed, id: snap.id, found: true, doc: data, storage: { bucket: storageBucketName, outputPath: outputPath || null, exists } })
  } catch (err) {
    console.error('JOB_DEBUG_ERROR', err && (err.stack || err.message || err))
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) })
  }
})

module.exports = router
