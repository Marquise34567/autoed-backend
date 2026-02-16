// Usage: node scripts/check_input_exists.js [bucket] [objectPath]
// Defaults: bucket from env FIREBASE_STORAGE_BUCKET or 'autoeditor-d4940-uploads-01'
//          objectPath default 'test-inputs/prod-test.mp4'
const path = require('path')
const fs = require('fs')
;(async function main(){
  try {
    const args = process.argv.slice(2)
    const bucket = args[0] || process.env.FIREBASE_STORAGE_BUCKET || 'autoeditor-d4940-uploads-01'
    const objectPath = args[1] || 'test-inputs/prod-test.mp4'

    const cwd = process.cwd()
    const candidates = ['sa.json', 'service-account.json', 'serviceAccountKey.json']
    const saPath = candidates.map(c=>path.resolve(cwd, c)).find(p=>fs.existsSync(p))
    if (!saPath) {
      console.error('No service account JSON found. Place sa.json or service-account.json in the repo root.')
      process.exit(2)
    }
    const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'))
    console.log('Using service account:', sa.client_email)
    console.log('Checking bucket:', bucket)
    console.log('Checking object:', objectPath)

    const { Storage } = require('@google-cloud/storage')
    const storage = new Storage({ credentials: sa, projectId: sa.project_id })
    const file = storage.bucket(bucket).file(objectPath)
    try {
      const [exists] = await file.exists()
      console.log('exists=', exists)
      if (!exists) {
        // try alternative if bucket looks like web-host (firebasestorage.app)
        if (bucket.endsWith('.app')) {
          const alt = bucket.replace('.app', '.appspot.com')
          console.log('Trying alternative bucket:', alt)
          const [e2] = await storage.bucket(alt).file(objectPath).exists()
          console.log('alt exists=', e2)
        }
      }
      process.exit(0)
    } catch (e) {
      console.error('Error while checking object:', e && (e.stack || e.message || e))
      process.exit(3)
    }
  } catch (err) {
    console.error('FATAL:', err && (err.stack || err.message || err))
    process.exit(1)
  }
})()
