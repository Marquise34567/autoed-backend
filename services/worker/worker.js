const admin = require('../../utils/firebaseAdmin')
const { processJob } = require('./processJob')
const fs = require('fs')
const path = require('path')

const db = admin.db

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
  // Find one queued job
  const q = await db.collection('jobs').where('status', '==', 'queued').orderBy('createdAt', 'asc').limit(1).get()
  if (q.empty) return null
  const doc = q.docs[0]
  const ref = doc.ref
  try {
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const data = snap.exists ? snap.data() : null
      if (!data) return null
      if (data.status && data.status !== 'queued') return null
      tx.update(ref, { status: 'processing', progress: 0, startedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: Date.now() })
      return { id: ref.id, data }
    })
    return claimed
  } catch (e) {
    log(null, 'claim transaction failed', e && (e.message || e))
    return null
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
      log(jobId, 'claimed')
      // fetch latest data
      const snap = await db.collection('jobs').doc(jobId).get()
      const jobDoc = snap.exists ? snap.data() : null
      let inputSpec = (jobDoc && jobDoc.inputSpec) || jobDoc || null
      try {
        // call processJob which updates Firestore itself
        log(jobId, 'input resolved, starting processJob')
        await processJob(jobId, inputSpec)
        log(jobId, 'processing finished')
      } catch (e) {
        log(jobId, 'processing error', e && (e.message || e))
        try { await db.collection('jobs').doc(jobId).set({ status: 'error', progress: 0, error: e && (e.message || String(e)), updatedAt: Date.now() }, { merge: true }) } catch (er) { log(jobId, 'failed to write error state', er) }
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
