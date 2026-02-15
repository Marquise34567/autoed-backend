// Debug helper: generate a signed URL using local sa.json and print detailed info
const path = require('path')
const fs = require('fs')
;(async function main(){
  try {
    const args = process.argv.slice(2)
    if (!args[0]) {
      console.error('Usage: node utils/debugSign.js <jobId> [bucket]')
      process.exit(2)
    }
    const jobId = args[0]
    const bucket = args[1] || 'autoeditor-d4940-uploads-01'
    const saPath = path.resolve(process.cwd(), 'sa.json')
    if (!fs.existsSync(saPath)) {
      console.error('sa.json not found at', saPath)
      process.exit(3)
    }
    const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'))
    console.log('Using sa.client_email=', sa.client_email)
    console.log('Using sa.project_id=', sa.project_id)

    const { Storage } = require('@google-cloud/storage')
    const storage = new Storage({ credentials: sa, projectId: sa.project_id })
    const objectPath = `results/${jobId}/result.json`
    console.log('Attempting to sign:', `${bucket}/${objectPath}`)
    try {
      const expires = Date.now() + 30 * 60 * 1000
      const [url] = await storage.bucket(bucket).file(objectPath).getSignedUrl({ version: 'v4', action: 'read', expires })
      console.log('SIGNED_URL:\n', url)
      // print credential portion
      try {
        const m = url.match(/X-Goog-Credential=([^&]+)/)
        if (m) console.log('X-Goog-Credential (url-encoded)=', m[1])
      } catch(_){}
      process.exit(0)
    } catch (e) {
      console.error('getSignedUrl ERROR:')
      console.error(e && (e.stack || e.message || e))
      process.exit(4)
    }
  } catch (err) {
    console.error('FATAL:', err && (err.stack || err.message || err))
    process.exit(1)
  }
})()
