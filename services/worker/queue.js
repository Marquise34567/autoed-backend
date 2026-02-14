const { processJob } = require('./processJob')
const admin = require('../../utils/firebaseAdmin')
const db = admin.db

const queue = []
let isProcessing = false

function log(...args) { console.log('[queue]', ...args) }

async function processNext() {
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
      await db.collection('jobs').doc(jobId).set({ status: 'processing', progress: 0, message: 'Processing started', updatedAt: Date.now() }, { merge: true })
    }
    // call the worker
    await processJob(jobId, inputSpec)
    // ensure final state updated by worker; if worker didn't set, mark done
    if (db) {
      const snap = await db.collection('jobs').doc(jobId).get()
      const data = snap.exists ? snap.data() : null
      if (data && data.status !== 'done' && data.status !== 'error') {
        await db.collection('jobs').doc(jobId).set({ status: 'done', progress: 100, updatedAt: Date.now(), message: 'Completed by queue' }, { merge: true })
      }
    }
  } catch (err) {
    log('Error processing', jobId, err && (err.stack || err.message || err))
    try {
      if (db) await db.collection('jobs').doc(jobId).set({ status: 'error', progress: 0, error: err && (err.message || String(err)), updatedAt: Date.now() }, { merge: true })
    } catch (e) { log('failed to mark job error', e) }
  } finally {
    isProcessing = false
    // process next in queue
    setImmediate(() => processNext())
  }
}

function enqueue(jobId, inputSpec) {
  queue.push({ jobId, inputSpec })
  log('Enqueued', jobId)
  // kick the queue
  setImmediate(() => processNext())
}

function reenqueue(jobId, inputSpec) {
  // place at front
  queue.unshift({ jobId, inputSpec })
  log('Re-enqueued', jobId)
  setImmediate(() => processNext())
}

function listQueued() { return queue.map(i => i.jobId) }

module.exports = { enqueue, reenqueue, listQueued }
