import { createServer } from './server'
import { PORT, WORKER_ENABLED } from './env'
import { initFirebase } from './firebaseAdmin'
import prisma from './db/prisma'
import { processJobLoop } from './jobs/jobs.worker'

async function main() {
  initFirebase()
  const app = createServer()
  const server = app.listen(PORT, () => {
    console.log('✅ Booting backend entry:', process.cwd())
    console.log('✅ Listening on', PORT)
  })

  // start worker if enabled
  if (WORKER_ENABLED) {
    console.log('[worker] enabled -> starting')
    processJobLoop().catch(e => console.error('[worker] loop failed', e))
  } else {
    console.log('[worker] disabled by env')
  }

  // graceful shutdown
  process.on('SIGINT', async () => {
    console.log('[shutdown] SIGINT')
    try { await prisma.$disconnect() } catch (e) {}
    server.close(() => process.exit(0))
  })
}

main().catch(e => { console.error(e); process.exit(1) })
