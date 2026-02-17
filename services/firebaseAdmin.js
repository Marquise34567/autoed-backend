// Central Firebase Admin initializer for the backend
// Supports FIREBASE_SERVICE_ACCOUNT_JSON (preferred) or split env vars
const adminLib = require('firebase-admin')

const DEFAULT_BUCKET = 'autoeditor-d4940.firebasestorage.app'
const storageBucketEnvRaw = (process.env.FIREBASE_STORAGE_BUCKET || '').trim()
const storageBucket = storageBucketEnvRaw || DEFAULT_BUCKET

let admin = null
let db = null
let bucket = null

function makeMissingError(missing) {
  const e = new Error('Firebase not configured: missing ' + missing.join(', '))
  e._missing = missing
  return e
}

try {
  // Try single JSON env first
  const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || ''
  let credential = null
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
    const missing = ['FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY']
    console.warn('[firebaseAdmin] Firebase credentials not configured. Missing:', missing.join(', '))
    // export a stub that throws when used
    const stub = {
      _missingEnv: missing,
      admin: null,
      db: null,
      bucket: null,
      getBucket: () => { throw makeMissingError(missing) }
    }
    module.exports = stub
  } else {
    admin = adminLib
    if (!admin.apps.length) {
      admin.initializeApp({ credential, storageBucket })
      console.log('[startup] Firebase initialized OK:', storageBucket)
    }
    db = admin.firestore()
    try { bucket = admin.storage().bucket(storageBucket) } catch (e) { bucket = null }

    // Attach convenience properties to the admin object for backwards-compatibility
    try { admin.db = db } catch (e) {}
    try { admin.bucket = bucket } catch (e) {}
    admin.getBucket = (name) => admin.storage().bucket(name || storageBucket)
    admin.getBucketName = () => storageBucket

    module.exports = { admin, db, bucket }
  }
} catch (e) {
  console.error('[firebaseAdmin] initialization error', e && (e.stack || e.message || e))
  module.exports = { admin: null, db: null, bucket: null }
}
