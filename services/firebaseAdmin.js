const admin = require('firebase-admin')

function getBucketNameFromEnv() {
  const raw = process.env.FIREBASE_STORAGE_BUCKET || ''
  if (!raw) return null
  const s = String(raw).trim()
  const stripped = s.replace(/^"|"$/g, '').replace(/^'|'$/g, '')
  return stripped.replace(/^gs:\/\//i, '').trim() || null
}

function getServiceAccountFromJson() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  if (!raw) return null
  let jsonStr = raw
  // If the value does not look like JSON, treat it as a file path and try to read it
  try {
    const s = String(raw).trim()
    if (!s.startsWith('{')) {
      const fs = require('fs')
      if (fs.existsSync(s)) {
        jsonStr = fs.readFileSync(s, 'utf8')
      }
    }
  } catch (e) {
    // ignore - we'll try to parse whatever we have
  }
  try {
    const svc = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr
    if (svc && svc.private_key) svc.private_key = String(svc.private_key).replace(/\\n/g, '\n')
    return svc
  } catch (e) {
    throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON or read service account file: ' + (e && e.message ? e.message : String(e)))
  }
}

function getCredentialFromSplitEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY
  if (!projectId || !clientEmail || !privateKeyRaw) return null
  return {
    projectId,
    clientEmail,
    privateKey: String(privateKeyRaw).replace(/\\n/g, '\n'),
  }
}

const admin = require('firebase-admin')

function init() {
  if (admin.apps.length) return

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  const bucketName = (process.env.FIREBASE_STORAGE_BUCKET || '').trim()

  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON')
  if (!bucketName) throw new Error('Missing FIREBASE_STORAGE_BUCKET')

  let serviceAccount = null
  try {
    serviceAccount = JSON.parse(raw)
  } catch (e) {
    throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: ' + (e && e.message))
  }
  // Ensure private_key newlines are correct
  if (serviceAccount && typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n')
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: bucketName,
  })

  console.log('[firebaseAdmin] initialized. bucket:', bucketName)
}

init()

const db = admin.firestore()
const bucket = admin.storage().bucket() // uses storageBucket from initializeApp

module.exports = {
  admin,
  db,
  bucket,
  getBucket: () => bucket,
}
