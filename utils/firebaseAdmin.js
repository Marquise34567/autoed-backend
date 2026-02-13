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

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  })
  console.log('[firebaseAdmin] initialized via FIREBASE_SERVICE_ACCOUNT_JSON')
}

// Verify storage bucket exists and is accessible.
// Accept values like "my-bucket" or "gs://my-bucket/path/to/prefix".
const rawBucket = process.env.FIREBASE_STORAGE_BUCKET
if (!rawBucket) {
  console.error('[firebaseAdmin] FIREBASE_STORAGE_BUCKET is not set')
  throw new Error('FIREBASE_STORAGE_BUCKET is not set')
}

// Normalize: strip gs:// and extract bucket name and optional prefix path
const normalized = rawBucket.replace(/^gs:\/\//i, '')
const parts = normalized.split('/')
const bucketName = parts.shift()
const bucketPrefix = parts.length ? parts.join('/').replace(/^\/|\/$/g, '') : ''

const bucket = admin.storage().bucket(bucketName)
;(async () => {
  try {
    const [exists] = await bucket.exists()
    if (!exists) {
      // Only attempt to auto-create if explicitly requested to avoid permission/domain checks.
      if (String(process.env.FIREBASE_AUTO_CREATE_BUCKET).toLowerCase() === 'true') {
        console.warn(`[firebaseAdmin] Storage bucket does not exist: ${bucketName} — attempting to create`)
        try {
          await admin.storage().bucket(bucketName).create({
            location: process.env.GCS_BUCKET_LOCATION || 'US',
            storageClass: process.env.GCS_BUCKET_STORAGE_CLASS || 'STANDARD',
          })
          console.log(`[firebaseAdmin] Successfully created storage bucket: ${bucketName}`)
        } catch (createErr) {
          console.error('[firebaseAdmin] Failed to create storage bucket:', createErr && createErr.message ? createErr.message : createErr)
          throw createErr
        }
      } else {
        console.error(`[firebaseAdmin] Storage bucket does not exist: ${bucketName}. To auto-create set FIREBASE_AUTO_CREATE_BUCKET=true or create the bucket manually.`)
        throw new Error(`Storage bucket does not exist: ${bucketName}`)
      }
    } else {
      console.log(`[firebaseAdmin] Storage bucket verified: ${bucketName}`)
    }
  } catch (e) {
    console.error('[firebaseAdmin] Error checking storage bucket:', e && e.message ? e.message : e)
    // Re-throw to fail fast in startup
    throw e
  }
})()

// Export admin and helpers for convenience
const db = admin.firestore()
module.exports = admin
module.exports.db = db
module.exports.bucket = bucket
