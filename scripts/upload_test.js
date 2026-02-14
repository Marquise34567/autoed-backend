const fs = require('fs')
const os = require('os')
const path = require('path')
const {Storage} = require('@google-cloud/storage')

async function main() {
  const saPath = path.resolve(process.cwd(), 'service-account.json')
  if (!fs.existsSync(saPath)) {
    console.error('service-account.json not found')
    process.exit(1)
  }
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'))
  const projectId = sa.project_id
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || sa.project_id + '.appspot.com'
  const bucketName = storageBucket.replace(/^gs:\/\//,'')
  const client = new Storage({ projectId, credentials: sa })
  const tmp = path.join(os.tmpdir(), `upload-test-${Date.now()}.txt`)
  fs.writeFileSync(tmp, 'hello from upload_test')
  const remote = `test-uploads/${path.basename(tmp)}`
  console.log('Uploading', tmp, '->', bucketName + '/' + remote)
  await client.bucket(bucketName).upload(tmp, { destination: remote })
  console.log('Uploaded:', remote)
  const out = { bucket: bucketName, path: remote }
  fs.writeFileSync(path.resolve(process.cwd(), 'last_upload.json'), JSON.stringify(out))
  console.log(JSON.stringify(out))
}

main().catch((e) => { console.error(e); process.exit(1) })
