const admin = require('firebase-admin')

if (!admin.apps.length) {
  const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
  const missing = required.filter((k) => !process.env[k])
  if (missing.length) {
    throw new Error(`Missing required Firebase environment variables: ${missing.join(', ')}`)
  }

  // Safely construct the service account credential without logging secrets
  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Convert escaped newlines into real newlines
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }

  try {
    const initOptions = { credential: admin.credential.cert(serviceAccount) }
    if (process.env.FIREBASE_STORAGE_BUCKET) initOptions.storageBucket = process.env.FIREBASE_STORAGE_BUCKET
    admin.initializeApp(initOptions)
    console.log('[firebaseAdmin] initialized via FIREBASE_* environment variables')
  } catch (e) {
    console.error('[firebaseAdmin] Failed to initialize Firebase Admin SDK:', e && e.message ? e.message : e)
    throw e
  }
}

// Verify storage bucket exists and is accessible.
// Accept values like "my-bucket" or "gs://my-bucket/path/to/prefix".
const rawBucket = process.env.FIREBASE_STORAGE_BUCKET
if (!rawBucket) {
  console.warn('[firebaseAdmin] FIREBASE_STORAGE_BUCKET is not set — storage features will be disabled until configured')
} else {
  // Normalize: strip gs:// and extract bucket name and optional prefix path
  const normalized = rawBucket.replace(/^gs:\/\//i, '')
  const parts = normalized.split('/')
  var bucketName = parts.shift()
  var bucketPrefix = parts.length ? parts.join('/').replace(/^\/|\/$/g, '') : ''
}

let bucket = null
if (typeof bucketName !== 'undefined' && bucketName) {
  bucket = admin.storage().bucket(bucketName)
  ;(async () => {
    try {
      const [exists] = await bucket.exists()
      if (!exists) {
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
          }
        } else {
          console.warn(`[firebaseAdmin] Storage bucket does not exist: ${bucketName}. To auto-create set FIREBASE_AUTO_CREATE_BUCKET=true or create the bucket manually.`)
        }
      } else {
        console.log(`[firebaseAdmin] Storage bucket verified: ${bucketName}`)
      }
    } catch (e) {
      console.error('[firebaseAdmin] Error checking storage bucket:', e && e.message ? e.message : e)
    }
  })()
}

// Startup log: indicate if bucket is configured
console.log('[firebaseAdmin] BUCKET=' + (rawBucket ? 'SET' : 'MISSING'))

// Export admin and helpers for convenience
const db = admin.firestore()
module.exports = admin
module.exports.db = db
module.exports.bucket = bucket
module.exports.getBucket = function(name) {
  if (!rawBucket && !name) throw new Error('FIREBASE_STORAGE_BUCKET missing')
  if (!bucket && !name) throw new Error('FIREBASE_STORAGE_BUCKET missing')
  if (name) return admin.storage().bucket(name)
  return bucket
}
