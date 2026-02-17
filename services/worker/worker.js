const admin = require('../firebaseAdmin')
const db = (admin && (admin.db || (typeof admin.firestore === 'function' ? admin.firestore() : null))) || null
const { exec } = require('child_process')
const { processJob } = require('./processJob')
const fs = require('fs')
const path = require('path')
const { listQueued } = require('./queue')

// `db` provided by services/firebaseAdmin

if (!db) {
  console.warn('[worker] Firestore db is undefined; worker will not start until db is available')
}

const os = require('os')
const POLL_MS = parseInt(process.env.WORKER_POLL_MS || '2000', 10)
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '2', 10)
function envTrue(v) { return ["1", "true", "yes", "y", "on"].includes(String(v || "").toLowerCase()) }
const isProd = process.env.NODE_ENV === 'production'
// Align worker enablement with index.js: only enable when WORKER_ENABLED==='true'
const WORKER_ENABLED = String(process.env.WORKER_ENABLED) === 'true'
const PROCESSING_TIMEOUT_MS = parseInt(process.env.JOB_PROCESSING_TIMEOUT_MS || String(30 * 60 * 1000), 10)

let started = false
let stopping = false
const GRACEFUL_SHUTDOWN_MS = parseInt(process.env.WORKER_GRACEFUL_SHUTDOWN_MS || String(30 * 1000), 10)
let keepaliveTimer = null

let running = false
let heartbeatTimer = null
const activeJobs = new Map() // jobId -> Promise
const startTime = Date.now()

function log(jobId, ...args) {
  if (jobId) console.log('[worker]', jobId, ...args)
  else console.log('[worker]', ...args)
}

function sanitizeStatus(s) {
  const allowed = ['queued', 'processing', 'completed', 'failed']
  const v = (s || '').toString().toLowerCase()
  return allowed.includes(v) ? v : null
}

console.log('[worker] enabled =', WORKER_ENABLED, 'NODE_ENV =', process.env.NODE_ENV)
console.log('[worker] Firestore db initialized:', !!db)

async function claimOne() {
  if (!db) return null
  const workerId = process.env.RAILWAY_SERVICE_NAME || os.hostname()
  // Log scan intent
  log(null, "scan: querying jobs where status=='queued' (with uppercase fallback)")
  // Watchdog: find stuck processing jobs older than threshold and mark failed
  try {
    if (PROCESSING_TIMEOUT_MS > 0) {
      const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - PROCESSING_TIMEOUT_MS)
      const stale = await db.collection('jobs').where('status', '==', 'processing').where('lockedAt', '<', cutoff).limit(10).get()
      if (!stale.empty) {
        for (const doc of stale.docs) {
          try {
            await doc.ref.set({ status: 'failed', errorMessage: 'worker watchdog: processing timeout', failedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
            log(doc.id, 'watchdog marked as failed due to timeout')
          } catch (e) { log(doc.id, 'watchdog failed to mark', e && (e.message || e)) }
        }
      }
    }
  } catch (e) { log(null, 'watchdog error', e && (e.message || e)) }
  try {
    // First try lowercase queued; if none, try legacy uppercase QUEUED
    let q = await db.collection('jobs').where('status', '==', 'queued').limit(1).get()
    if (q.empty) {
      q = await db.collection('jobs').where('status', '==', 'QUEUED').limit(1).get()
    }
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
        // Accept only jobs that are explicitly queued (support old uppercase)
        if (!data.status || String(data.status).toLowerCase() !== 'queued') return null
        log(ref.id, 'found job with status', data.status)
        // Enforce lock age: allow claim only if lockedAt is null or older than 5 minutes
        const nowMs = Date.now()
        const LOCK_AGE_MS = 5 * 60 * 1000
        if (data.lockedAt) {
          let lockedMillis = 0
          try { lockedMillis = data.lockedAt.toMillis ? data.lockedAt.toMillis() : (new Date(data.lockedAt)).getTime() } catch (e) { lockedMillis = 0 }
          if (lockedMillis && (nowMs - lockedMillis) < LOCK_AGE_MS) return null
        }
        tx.update(ref, { status: sanitizeStatus('processing'), progress: 5, lockedAt: admin.firestore.FieldValue.serverTimestamp(), workerId, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        return { id: ref.id, data }
      })
      if (claimed) log(claimed.id, 'claimed job', claimed.id, 'by', workerId, 'oldStatus=', claimed.data && claimed.data.status)
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
  stopping = false
  log(null, `started; poll_ms=${POLL_MS} concurrency=${CONCURRENCY}`)

  // heartbeat
  heartbeatTimer = setInterval(() => log(null, `alive; inFlight=${activeJobs.size}; queueScan...`), 30000)
  // ensure Node stays alive even if other handles close
  keepaliveTimer = setInterval(() => {}, 60 * 60 * 1000)

  while (running && !stopping) {
    try {
      // Enforce concurrency limit
      if (activeJobs.size >= CONCURRENCY) {
        await new Promise(r => setTimeout(r, POLL_MS))
        continue
      }
      // try to claim a single job; loop respects concurrency
      const claimed = await claimOne()
      if (!claimed) {
        // sleep when no jobs
        await new Promise(r => setTimeout(r, POLL_MS))
        continue
      }
      const jobId = claimed.id
      // fetch latest data
      const snap = await db.collection('jobs').doc(jobId).get()
      const jobDoc = snap.exists ? snap.data() : null
      let inputSpec = (jobDoc && jobDoc.inputSpec) || jobDoc || null

      // Immediately mark progress to ensure frontend sees work started
      try {
        await db.collection('jobs').doc(jobId).update({
          progress: 10,
          status: 'processing',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        })
      } catch (e) {
        log(jobId, 'failed to mark progress after claim', e && (e.message || e))
      }

      // Start processing without blocking the loop (up to concurrency limit)
      const p = (async () => {
        log(jobId, 'input resolved, starting processJob')
        try {
          const result = await processJob(jobId, inputSpec)
          log(jobId, 'processing finished', result)
          try {
            await db.collection('jobs').doc(jobId).update({
              progress: 100,
              status: sanitizeStatus('completed'),
              resultUrl: (result && result.resultUrl) || null,
              finalVideoPath: (result && result.finalVideoPath) || null,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            })
          } catch (er) { log(jobId, 'failed to mark completed', er) }
        } catch (e) {
          log(jobId, 'processing error', e && (e.stack || e.message || e))
          try {
            await db.collection('jobs').doc(jobId).update({
              status: sanitizeStatus('failed'),
              progress: 0,
              error: e && (e.message || String(e)),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            })
          } catch (er) { log(jobId, 'failed to write error state', er) }
        } finally {
          activeJobs.delete(jobId)
        }
      })()
      activeJobs.set(jobId, p)
    } catch (err) {
      log(null, 'worker loop error', err && (err.stack || err.message || err))
      await new Promise(r => setTimeout(r, POLL_MS))
    }
  }

  if (heartbeatTimer) clearInterval(heartbeatTimer)
  if (keepaliveTimer) clearInterval(keepaliveTimer)
  log(null, 'stopped')
}

function start() {
  if (!WORKER_ENABLED) return log(null, 'WORKER_ENABLED not true; skipping start')
  if (!db) {
    console.error('[worker] db missing; aborting worker start (will not crash process)')
    return
  }
  // check ffmpeg availability
  try {
    exec('ffmpeg -version', { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) log(null, 'ffmpeg check failed', err && (err.message || err))
      else log(null, 'ffmpeg available', stdout ? stdout.split('\n')[0] : '<no-output>')
    })
  } catch (e) { log(null, 'ffmpeg check error', e && (e.message || e)) }
  // run asynchronously and don't crash app on error
  setImmediate(() => {
    workerLoop().catch((e) => log(null, 'workerLoop top error', e && (e.stack || e.message || e)))
  })
  log(null, 'started successfully')
}

function stop() {
  running = false
}

module.exports = { start, stop }

function getStatus() {
  const workerId = process.env.RAILWAY_SERVICE_NAME || os.hostname()
  return {
    workerId,
    uptimeMs: Date.now() - startTime,
    activeJobs: Array.from(activeJobs.keys()),
    queuedCount: typeof listQueued === 'function' ? listQueued().length : 0
  }
}

module.exports.getStatus = getStatus
