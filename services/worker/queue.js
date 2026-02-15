const { processJob } = require('./processJob')
const admin = require('../../utils/firebaseAdmin')
const db = admin.db

const queue = []
let isProcessing = false

function log(...args) { console.log('[queue]', ...args) }

// If WORKER_IN_PROCESS is true, keep the legacy in-process queue behavior
const WORKER_IN_PROCESS = String(process.env.WORKER_IN_PROCESS || 'false').toLowerCase() === 'true'

async function processNext() {
  if (!WORKER_IN_PROCESS) return
  if (isProcessing) return
  const item = queue.shift()
  if (!item) {
    log('Queue empty')
    return
  }
  isProcessing = true
  const { jobId, inputSpec } = item
  try {
    log('Dequeued', jobId)
    // mark processing
    if (db) {
      await db.collection('jobs').doc(jobId).set({ status: 'PROCESSING', progress: 0, message: 'Processing started', updatedAt: Date.now() }, { merge: true })
    }
    // call the worker
    await processJob(jobId, inputSpec)
    // ensure final state updated by worker; if worker didn't set, mark done
    if (db) {
      const snap = await db.collection('jobs').doc(jobId).get()
      const data = snap.exists ? snap.data() : null
      if (data && data.status !== 'COMPLETE' && data.status !== 'FAILED') {
        await db.collection('jobs').doc(jobId).set({ status: 'COMPLETE', progress: 100, updatedAt: Date.now(), message: 'Completed by queue' }, { merge: true })
      }
    }
  } catch (err) {
    log('Error processing', jobId, err && (err.stack || err.message || err))
    try {
      if (db) await db.collection('jobs').doc(jobId).set({ status: 'FAILED', progress: 0, errorMessage: err && (err.message || String(err)), updatedAt: Date.now() }, { merge: true })
    } catch (e) { log('failed to mark job error', e) }
  } finally {
    isProcessing = false
    // process next in queue
    setImmediate(() => processNext())
  }
}

function enqueue(jobId, inputSpec) {
  // When running in API mode, avoid doing heavy processing in-process.
  // If WORKER_IN_PROCESS is enabled, behave as before for local/dev convenience.
  queue.push({ jobId, inputSpec })
  log('Enqueued', jobId, 'inProcessMode=', WORKER_IN_PROCESS)
  if (WORKER_IN_PROCESS) setImmediate(() => processNext())
}

function reenqueue(jobId, inputSpec) {
  queue.unshift({ jobId, inputSpec })
  log('Re-enqueued', jobId, 'inProcessMode=', WORKER_IN_PROCESS)
  if (WORKER_IN_PROCESS) setImmediate(() => processNext())
}

function listQueued() { return queue.map(i => i.jobId) }

module.exports = { enqueue, reenqueue, listQueued }
