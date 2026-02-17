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
        pkey = String(pkey).replace(/\n/g, '\n')
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
      // Build explicit init options to avoid ambiguity
      const initOptions = { credential }
      if (process.env.FIREBASE_PROJECT_ID) initOptions.projectId = process.env.FIREBASE_PROJECT_ID
      if (process.env.FIREBASE_STORAGE_BUCKET) initOptions.storageBucket = process.env.FIREBASE_STORAGE_BUCKET

      admin.initializeApp(initOptions)
      console.log('[firebaseAdmin] Firebase initialized OK')
      try {
        const appInstance = (admin && admin.app) ? admin.app() : null
        console.log('[fb] projectId(app.options)=', appInstance && appInstance.options && appInstance.options.projectId)
        console.log('[fb] FIREBASE_PROJECT_ID=', process.env.FIREBASE_PROJECT_ID || null)
        console.log('[fb] GOOGLE_CLOUD_PROJECT=', process.env.GOOGLE_CLOUD_PROJECT || null)
        console.log('[fb] FIRESTORE_EMULATOR_HOST=', process.env.FIRESTORE_EMULATOR_HOST || null)
        console.log('[fb] storageBucket(app.options)=', appInstance && appInstance.options && appInstance.options.storageBucket)
        console.log('[fb] FIREBASE_STORAGE_BUCKET=', process.env.FIREBASE_STORAGE_BUCKET || null)
        if (process.env.FIRESTORE_EMULATOR_HOST) console.warn('[fb] WARNING: FIRESTORE_EMULATOR_HOST is set; production will not see real Firestore.')
      } catch (e) { console.warn('[firebaseAdmin] failed to log projectId/envs', e && e.message) }
    }
    db = admin.firestore()
    try { bucket = admin.storage().bucket(storageBucket) } catch (e) { bucket = null }

    // Log Firestore settings for debugging (non-sensitive)
    try {
      const dbSettings = db && db._settings ? db._settings : null
      console.log('[firebaseAdmin] firestore settings:', dbSettings)
      if (db && db._databaseId) console.log('[firebaseAdmin] firestore databaseId=', db._databaseId)
    } catch (e) { console.warn('[firebaseAdmin] failed to read firestore settings', e && e.message) }

    // Attach convenience properties to the admin object for backwards-compatibility
    try { admin.db = db } catch (e) {}
    try { admin.bucket = bucket } catch (e) {}
    admin.getBucket = (name) => admin.storage().bucket(name || storageBucket)
    admin.getBucketName = () => storageBucket

    // Expose the initialized App instance and projectIdUsed for diagnostics
    try {
      const appInstance = (admin && admin.apps && admin.apps[0]) ? admin.apps[0] : (admin.app ? admin.app() : null)
      const projectIdUsed = (appInstance && appInstance.options && appInstance.options.projectId) ? appInstance.options.projectId : (process.env.FIREBASE_PROJECT_ID || null)
      admin.appInstance = appInstance
      admin.projectIdUsed = projectIdUsed
    } catch (e) {
      console.warn('[firebaseAdmin] failed to attach appInstance/projectIdUsed', e && e.message)
    }

    // Export the admin library as the module, but keep `admin.db` and `admin.bucket`
    // so callers using either `const admin = require('...')` or
    // `const { admin, db } = require('...')` will work.
    try { admin.admin = admin } catch (e) {}
    module.exports = admin
  }
} catch (e) {
  console.error('[firebaseAdmin] initialization error', e && (e.stack || e.message || e))
  module.exports = { admin: null, db: null, bucket: null }
}
