const path = require('path')
const fs = require('fs')

const root = path.resolve(__dirname, '..')
const saPath = path.join(root, '..', 'service-account.json.json')
if (!fs.existsSync(saPath)) {
  console.error('service account JSON not found at', saPath)
  process.exit(1)
}
let j = null
try {
  j = JSON.parse(fs.readFileSync(saPath, 'utf8'))
} catch (e) {
  console.error('Failed to parse service account JSON', e)
  process.exit(1)
}
process.env.FIREBASE_PROJECT_ID = j.project_id
process.env.FIREBASE_CLIENT_EMAIL = j.client_email
process.env.FIREBASE_PRIVATE_KEY = j.private_key
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(j)
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'autoeditor-d4940.appspot.com'
process.env.WORKER_ENABLED = 'true'
process.env.PORT = process.env.PORT || '8080'

console.log('Starting local backend with:')
console.log('FIREBASE_PROJECT_ID=', process.env.FIREBASE_PROJECT_ID)
console.log('FIREBASE_CLIENT_EMAIL=', process.env.FIREBASE_CLIENT_EMAIL)
console.log('FIREBASE_STORAGE_BUCKET=', process.env.FIREBASE_STORAGE_BUCKET)
console.log('WORKER_ENABLED=', process.env.WORKER_ENABLED)

// Require the main server file
require(path.join(root, 'index.js'))
