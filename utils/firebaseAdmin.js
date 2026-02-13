const admin = require('firebase-admin')

if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON')
  }

  let serviceAccount
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  } catch (e) {
    console.error('[firebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', e && e.message ? e.message : e)
    throw e
  }

  // We'll normalize FIREBASE_STORAGE_BUCKET below and only pass a storageBucket
  // option if we can parse a sensible bucket name. This prevents defaulting to
  // any *.appspot.com bucket that might be present by accident.
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  })
  console.log('[firebaseAdmin] initialized via FIREBASE_SERVICE_ACCOUNT_JSON')
}

// Read and normalize FIREBASE_STORAGE_BUCKET. Accepts:
// - "autoeditor-d4940.firebasestorage.app"
// - "gs://autoeditor-d4940.firebasestorage.app"
// - "gs://autoeditor-d4940.firebasestorage.app/uploads"
// Also tolerate values accidentally using .appspot.com by converting to
// .firebasestorage.app to avoid defaulting to appspot buckets.
const rawBucket = (process.env.FIREBASE_STORAGE_BUCKET || '').trim()
let bucketName = null
let bucketPrefix = ''

if (rawBucket) {
  // strip gs://
  let normalized = rawBucket.replace(/^gs:\/\//i, '')
  // replace appspot.com suffix with firebasestorage.app to avoid appspot defaults
  normalized = normalized.replace(/\.appspot\.com$/i, '.firebasestorage.app')
  // remove leading/trailing slashes
  normalized = normalized.replace(/^\/+|\/+$/g, '')
  const parts = normalized.split('/')
  bucketName = parts.shift() || null
  if (parts.length) bucketPrefix = parts.join('/').replace(/^\/+|\/+$/g, '')
}

// If we have a bucketName, set it on the admin app so firebase.storage() uses it by default
if (bucketName) {
  try {
    admin.app().options = Object.assign(admin.app().options || {}, { storageBucket: bucketName })
    console.log('[firebaseAdmin] configured storageBucket:', bucketName, bucketPrefix ? `(prefix: ${bucketPrefix})` : '')
  } catch (e) {
    console.warn('[firebaseAdmin] Failed to attach storageBucket to admin app options:', e && e.message ? e.message : e)
  }
} else {
  console.warn('[firebaseAdmin] FIREBASE_STORAGE_BUCKET not provided or could not be parsed — storage features may be limited')
}

// Check bucket existence but do NOT throw on failure — log and continue so the
// server can start even if the bucket is misconfigured. This avoids crashing
// the whole app due to a storage configuration issue.
let bucketInstance = null
;(async () => {
  if (!bucketName) return
  try {
    const b = admin.storage().bucket(bucketName)
    const [exists] = await b.exists()
    if (!exists) {
      console.warn(`[firebaseAdmin] Storage bucket does not exist: ${bucketName}. To auto-create set FIREBASE_AUTO_CREATE_BUCKET=true or create the bucket manually.`)
      // Attempt auto-create only if explicitly enabled
      if (String(process.env.FIREBASE_AUTO_CREATE_BUCKET).toLowerCase() === 'true') {
        try {
          await admin.storage().bucket(bucketName).create({
            location: process.env.GCS_BUCKET_LOCATION || 'US',
            storageClass: process.env.GCS_BUCKET_STORAGE_CLASS || 'STANDARD',
          })
          console.log(`[firebaseAdmin] Successfully created storage bucket: ${bucketName}`)
        } catch (createErr) {
          console.warn('[firebaseAdmin] Failed to create storage bucket:', createErr && createErr.message ? createErr.message : createErr)
        }
      }
    } else {
      console.log(`[firebaseAdmin] Storage bucket verified: ${bucketName}`)
      bucketInstance = b
    }
  } catch (e) {
    console.warn('[firebaseAdmin] Error checking storage bucket:', e && e.message ? e.message : e)
  }
})()

// Export admin and helpers for convenience
const db = admin.firestore()
module.exports = admin
module.exports.db = db
module.exports.bucketName = bucketName
module.exports.bucketPrefix = bucketPrefix
module.exports.getBucket = function () {
  if (bucketName) return admin.storage().bucket(bucketName)
  return admin.storage().bucket()
}
module.exports.bucket = bucketInstance
