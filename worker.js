// Lightweight worker entry for Railway service
// Starts the worker loop from services/worker/worker.js

process.on('unhandledRejection', (err) => {
  console.error('[worker] UNHANDLED_REJECTION', err)
})
process.on('uncaughtException', (err) => {
  console.error('[worker] UNCAUGHT_EXCEPTION', err)
  process.exit(1)
})

// Ensure WORKER_ENABLED is true when running this entry point
process.env.WORKER_ENABLED = process.env.WORKER_ENABLED || 'true'

const worker = require('./services/worker/worker')

console.log('Worker entry starting...')
try {
  worker.start()
  console.log('Worker started')
} catch (e) {
  console.error('Failed to start worker', e)
  process.exit(1)
}
