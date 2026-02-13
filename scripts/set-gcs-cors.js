// Script to set CORS on the configured GCS bucket via Firebase Admin
// Usage: ensure FIREBASE_SERVICE_ACCOUNT_JSON and FIREBASE_STORAGE_BUCKET are set, then
//   node scripts/set-gcs-cors.js

const admin = require('../utils/firebaseAdmin')

async function main() {
  try {
    const rawBucket = process.env.FIREBASE_STORAGE_BUCKET
    if (!rawBucket) throw new Error('FIREBASE_STORAGE_BUCKET not set')
    const normalized = rawBucket.replace(/^gs:\/\//i, '')
    const parts = normalized.split('/')
    const bucketName = parts.shift()

    const bucket = admin.storage().bucket(bucketName)

    const corsConfig = [
      {
        origin: ['https://autoeditor.app', 'https://www.autoeditor.app'],
        method: ['GET', 'HEAD', 'PUT', 'POST', 'OPTIONS'],
        responseHeader: ['Content-Type', 'Authorization', 'X-Goog-Upload-Status', 'X-Goog-Upload-Protocol'],
        maxAgeSeconds: 3600,
      },
    ]

    console.log('Setting CORS on bucket:', bucketName)
    await bucket.setMetadata({ cors: corsConfig })
    console.log('CORS set successfully')
  } catch (err) {
    console.error('Failed to set CORS:', err && err.message ? err.message : err)
    process.exitCode = 2
  }
}

main()
