const admin = require('../../utils/firebaseAdmin')
const { processJob } = require('./processJob')
const fs = require('fs')
const path = require('path')

const db = admin.db

const os = require('os')
const POLL_MS = parseInt(process.env.WORKER_POLL_MS || '2000', 10)
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '1', 10)
const WORKER_ENABLED = String(process.env.WORKER_ENABLED || 'false').toLowerCase() === 'true'

let running = false
let heartbeatTimer = null

function log(jobId, ...args) {
  if (jobId) console.log('[worker]', jobId, ...args)
  else console.log('[worker]', ...args)
}

async function claimOne() {
  if (!db) return null
  const workerId = process.env.RAILWAY_SERVICE_NAME || os.hostname()
  // Log scan intent
  log(null, "scan: querying jobs where status=='queued'")
  try {
    // Find one queued job
    const q = await db.collection('jobs').where('status', '==', 'queued').orderBy('createdAt', 'asc').limit(1).get()
    if (q.empty) {
      log(null, 'scan result: 0 queued jobs')
      return null
    }
    const doc = q.docs[0]
    const ref = doc.ref
    try {
      const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        const data = snap.exists ? snap.data() : null
        if (!data) return null
        // Accept only jobs that are explicitly queued
        if (!data.status || String(data.status).toLowerCase() !== 'queued') return null
        tx.update(ref, { status: 'processing', progress: 0, lockedAt: admin.firestore.FieldValue.serverTimestamp(), workerId, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        return { id: ref.id, data }
      })
      if (claimed) log(claimed.id, 'claimed job', claimed.id, 'by', workerId)
      return claimed
    } catch (e) {
      log(null, 'claim transaction failed', e && (e.stack || e.message || e))
      return null
    }
  } catch (err) {
    log(null, 'scan error', err && (err.stack || err.message || err))
    throw err
  }
}

async function workerLoop() {
  if (!WORKER_ENABLED) return log(null, 'worker disabled by env')
  if (running) return
  running = true
  log(null, `started; poll_ms=${POLL_MS} concurrency=${CONCURRENCY}`)

  // heartbeat
  heartbeatTimer = setInterval(() => log(null, 'alive; queue scan...'), 30000)

  while (running) {
    try {
      const claimed = await claimOne()
      if (!claimed) {
        // sleep
        await new Promise(r => setTimeout(r, POLL_MS))
        continue
      }
      const jobId = claimed.id
      // fetch latest data
      const snap = await db.collection('jobs').doc(jobId).get()
      const jobDoc = snap.exists ? snap.data() : null
      let inputSpec = (jobDoc && jobDoc.inputSpec) || jobDoc || null
      try {
        // call processJob which updates Firestore itself
        log(jobId, 'input resolved, starting processJob')
        await processJob(jobId, inputSpec)
        log(jobId, 'processing finished')
        try { await db.collection('jobs').doc(jobId).set({ status: 'completed', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }) } catch (er) { log(jobId, 'failed to mark completed', er) }
      } catch (e) {
        log(jobId, 'processing error', e && (e.stack || e.message || e))
        try { await db.collection('jobs').doc(jobId).set({ status: 'failed', progress: 0, error: e && (e.message || String(e)), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }) } catch (er) { log(jobId, 'failed to write error state', er) }
      }
    } catch (err) {
      log(null, 'worker loop error', err && (err.stack || err.message || err))
      await new Promise(r => setTimeout(r, POLL_MS))
    }
  }

  if (heartbeatTimer) clearInterval(heartbeatTimer)
  log(null, 'stopped')
}

function start() {
  if (!WORKER_ENABLED) return log(null, 'WORKER_ENABLED not true; skipping start')
  // run asynchronously and don't crash app on error
  setImmediate(() => {
    workerLoop().catch((e) => log(null, 'workerLoop top error', e && (e.stack || e.message || e)))
  })
}

function stop() {
  running = false
}

module.exports = { start, stop }
