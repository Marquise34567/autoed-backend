// Initialize Firebase Admin from FIREBASE_SERVICE_ACCOUNT_JSON only
const adminLib = require('firebase-admin')

// Prefer single service-account JSON string in env: FIREBASE_SERVICE_ACCOUNT_JSON
let serviceAccount = null
try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || ''
  if (raw && raw.trim()) {
    serviceAccount = JSON.parse(raw)
  }
} catch (e) {
  console.error('[firebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON', e && (e.stack || e.message || e))
  serviceAccount = null
}

const storageBucketEnv = (process.env.FIREBASE_STORAGE_BUCKET || '').trim() || 'autoeditor-d4940.appspot.com'

if (!serviceAccount || !serviceAccount.client_email || !serviceAccount.private_key) {
  const missing = ['FIREBASE_SERVICE_ACCOUNT_JSON']
  console.error('[firebaseAdmin] Missing or invalid service account JSON. Missing:', missing.join(', '))
  const stub = {
    _missingEnv: missing,
    apps: [],
    initializeApp: () => {},
    credential: { cert: () => { throw new Error('Firebase not configured') } },
    auth: () => { throw new Error('Firebase not configured') },
    firestore: () => { throw new Error('Firebase not configured') },
    storage: () => { throw new Error('Firebase not configured') },
    getBucket: () => { throw new Error('Firebase not configured') },
    getBucketName: () => null,
    db: null,
  }
  module.exports = stub
} else {
  // Ensure private key has real newlines
  try {
    serviceAccount.private_key = String(serviceAccount.private_key).replace(/\\n/g, '\n')
  } catch (e) {}

  const admin = adminLib
  if (!admin.apps.length) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: storageBucketEnv,
      })
      console.log('[startup] Firebase Admin initialized')
      try {
        console.log('[startup] Storage bucket:', admin.storage().bucket().name)
      } catch (e) {
        console.log('[startup] Storage bucket: (failed to read name)', e && e.message)
      }
    } catch (e) {
      console.error('[firebaseAdmin] initializeApp failed', e && (e.stack || e.message || e))
      throw e
    }
  }

  const bucket = admin.storage().bucket(storageBucketEnv)

  admin.getBucket = (name) => {
    const bn = name || storageBucketEnv
    return admin.storage().bucket(bn)
  }
  admin.getBucketName = () => storageBucketEnv

  module.exports = admin
  module.exports.getBucket = () => bucket
  module.exports.bucket = bucket
  module.exports.db = admin.firestore()
}
