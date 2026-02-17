const express = require('express')
const router = express.Router()

const admin = require('../services/firebaseAdmin')

router.post('/', async (req, res) => {
  try {
    const body = req.body || {}
    const storagePath = body.storagePath || body.filePath || body.path || null
    const jobId = body.jobId || null
    const userId = body.userId || null

    if (!storagePath) return res.status(400).json({ ok: false, error: 'Missing storagePath' })

    if (!admin || !admin.firestore) return res.status(500).json({ ok: false, error: 'Firestore not configured' })
    const db = admin.firestore()

    const now = admin.firestore.FieldValue.serverTimestamp()

    if (jobId) {
      // Update existing job to queued
      try {
        await db.collection('jobs').doc(jobId).set({ status: 'queued', phase: 'QUEUED', inputPath: storagePath, updatedAt: now, userId: userId || null }, { merge: true })
        console.log('[upload-complete] jobId=' + jobId + ' marked queued for processing')
        return res.status(200).json({ ok: true, jobId })
      } catch (e) {
        console.error('[upload-complete] failed to mark job queued', e && (e.stack || e.message || e))
        return res.status(500).json({ ok: false, error: 'failed_to_mark_job' })
      }
    }

    // No jobId: create a new queued job
    const id = (require('crypto').randomUUID && require('crypto').randomUUID()) || `${Date.now()}-${Math.floor(Math.random()*100000)}`
    const doc = {
      id,
      jobId: id,
      userId: userId || null,
      inputPath: storagePath,
      status: 'queued',
      phase: 'QUEUED',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await db.collection('jobs').doc(id).set(doc, { merge: true })
      console.log('[upload-complete] created queued job', id, 'for', storagePath)
      return res.status(200).json({ ok: true, jobId: id })
    } catch (e) {
      console.error('[upload-complete] failed to create job', e && (e.stack || e.message || e))
      return res.status(500).json({ ok: false, error: 'failed_to_create_job' })
    }
  } catch (err) {
    console.error('[upload-complete] error', err && (err.stack || err.message || err))
    return res.status(500).json({ ok: false, error: 'internal_error' })
  }
})

module.exports = router
