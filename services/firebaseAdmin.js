const admin = require('firebase-admin')

function getBucketNameFromEnv() {
  const raw = process.env.FIREBASE_STORAGE_BUCKET || ''
  if (!raw) return null
  const s = String(raw).trim()
  const stripped = s.replace(/^"|"$/g, '').replace(/^'|'$/g, '')
  return stripped.replace(/^gs:\/\//i, '').trim() || null
}

function getServiceAccountFromJson() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  if (!json) return null
  try {
    const svc = typeof json === 'string' ? JSON.parse(json) : json
    if (svc && svc.private_key) svc.private_key = String(svc.private_key).replace(/\\n/g, '\n')
    return svc
  } catch (e) {
    throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: ' + (e && e.message ? e.message : String(e)))
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

const bucketName = getBucketNameFromEnv() || 'autoeditor-d4940.firebasestorage.app'

// Determine credential: prefer service account JSON, then split envs
let credential = null
const svc = getServiceAccountFromJson()
if (svc) {
  credential = admin.credential.cert(svc)
} else {
  const split = getCredentialFromSplitEnv()
  if (split) {
    credential = admin.credential.cert(split)
  }
}

if (!credential) {
  // Fail loudly: production should provide credentials via FIREBASE_SERVICE_ACCOUNT_JSON
  const msg = 'Firebase credentials not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY'
  console.error('[services/firebaseAdmin] ' + msg)
  throw new Error(msg)
}

// Initialize app
if (!admin.apps.length) {
  admin.initializeApp({
    credential,
    storageBucket: bucketName,
  })
  console.log('[services/firebaseAdmin] initialized with storageBucket:', bucketName)
}

const db = admin.firestore()
const bucket = admin.storage().bucket(bucketName)

module.exports = { admin, db, bucket, getBucketName: () => bucketName }
