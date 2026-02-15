// Firebase Admin initializer: support both a single JSON env or split env vars.
const adminLib = require('firebase-admin')

const DEFAULT_BUCKET = 'autoeditor-d4940.firebasestorage.app'
const storageBucketEnvRaw = (process.env.FIREBASE_STORAGE_BUCKET || '').trim()
const storageBucket = storageBucketEnvRaw || DEFAULT_BUCKET

let credential = null
// Try service account JSON first
const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || ''
if (rawSa && rawSa.trim()) {
  try {
    const sa = JSON.parse(rawSa)
    if (sa && sa.client_email && sa.private_key) {
      sa.private_key = String(sa.private_key).replace(/\\n/g, '\n')
      credential = adminLib.credential.cert(sa)
    }
  } catch (e) {
    console.error('[firebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON', e && (e.message || e))
  }
}

// Fallback to split env vars
if (!credential) {
  const pid = process.env.FIREBASE_PROJECT_ID
  const cemail = process.env.FIREBASE_CLIENT_EMAIL
  let pkey = process.env.FIREBASE_PRIVATE_KEY
  if (pid && cemail && pkey) {
    try {
      pkey = String(pkey).replace(/\\n/g, '\n')
      credential = adminLib.credential.cert({ projectId: pid, clientEmail: cemail, privateKey: pkey })
    } catch (e) {
      console.error('[firebaseAdmin] Failed to initialize credential from env vars', e && (e.message || e))
    }
  }
}

if (!credential) {
  const missing = ['FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY']
  console.error('[firebaseAdmin] Firebase credentials not configured. Missing:', missing.join(', '))
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
  const admin = adminLib
  if (!admin.apps.length) {
    try {
      admin.initializeApp({
        credential,
        storageBucket: storageBucket,
      })
      console.log('[startup] Firebase initialized OK:', storageBucket)
    } catch (e) {
      console.error('[firebaseAdmin] initializeApp failed', e && (e.stack || e.message || e))
      throw e
    }
  }

  const bucket = admin.storage().bucket(storageBucket)

  admin.getBucket = (name) => {
    const bn = name || storageBucket
    return admin.storage().bucket(bn)
  }
  admin.getBucketName = () => storageBucket

  module.exports = admin
  module.exports.getBucket = () => bucket
  module.exports.bucket = bucket
  module.exports.db = admin.firestore()
}
