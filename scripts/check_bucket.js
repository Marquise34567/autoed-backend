const { Storage } = require('@google-cloud/storage')
const path = require('path')

const saPath = path.resolve(__dirname, '../tmp/service-account.json')
let sa
try { sa = require(saPath) } catch (e) { console.error('Failed to load service account JSON:', e && e.message); process.exit(2) }

const storage = new Storage({ projectId: sa.project_id, credentials: sa })
const bucketName = process.env.BUCKET || 'autoeditor-d4940.appspot.com'

;(async () => {
  console.log('serviceAccount.client_email=', sa.client_email)
  console.log('serviceAccount.project_id=', sa.project_id)
  console.log('checking bucket=', bucketName)
  try {
    const [exists] = await storage.bucket(bucketName).exists()
    console.log('bucket.exists =>', exists)
    if (!exists) return process.exit(0)
    const [meta] = await storage.bucket(bucketName).getMetadata()
    console.log('bucket.metadata:', { name: meta.name, location: meta.location, storageClass: meta.storageClass })
    try {
      const [policy] = await storage.bucket(bucketName).iam.getPolicy()
      console.log('iam policy bindings count=', policy.bindings ? policy.bindings.length : 0)
    } catch (e) {
      console.warn('iam.getPolicy failed:', e && e.message)
    }
    process.exit(0)
  } catch (e) {
    console.error('ERROR checking bucket:', e && (e.message || e))
    process.exit(3)
  }
})()
