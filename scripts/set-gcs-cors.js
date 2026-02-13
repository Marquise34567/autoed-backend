#!/usr/bin/env node
const { Storage } = require('@google-cloud/storage')
const fs = require('fs')

function getServiceAccount() {
  const env = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!env) return null
  // If env is a path to a file, read it
  if (env.trim().startsWith('{')) {
    try { return JSON.parse(env) } catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON') }
  }
  // otherwise treat as file path
  if (fs.existsSync(env)) {
    try { return JSON.parse(fs.readFileSync(env, 'utf8')) } catch (e) { throw new Error('Failed to parse service account file') }
  }
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be JSON string or path to JSON file')
}

function normalizeBucket(raw) {
  if (!raw) throw new Error('FIREBASE_STORAGE_BUCKET is not set')
  let v = String(raw).trim()
  v = v.replace(/^gs:\/\//i, '')
  // strip any path after bucket name
  const parts = v.split('/')
  return parts[0]
}

async function main() {
  try {
    const sa = getServiceAccount()
    const bucketName = normalizeBucket(process.env.FIREBASE_STORAGE_BUCKET)

    console.log('Using bucket:', bucketName)

    const storage = new Storage({ projectId: sa.project_id, credentials: sa })
    const bucket = storage.bucket(bucketName)

    const corsConfig = [
      {
        origin: [
          'https://autoeditor.app',
          'https://www.autoeditor.app',
          'https://*.vercel.app'
        ],
        method: ['GET','HEAD','PUT','POST','DELETE','OPTIONS'],
        responseHeader: ['Content-Type','Content-Length','x-goog-resumable','x-goog-meta-*','Authorization'],
        maxAgeSeconds: 3600
      }
    ]

    console.log('Applying CORS configuration:')
    console.log(JSON.stringify(corsConfig, null, 2))

    try {
      await bucket.setMetadata({ cors: corsConfig })
    } catch (e) {
      console.error('Failed to apply CORS to bucket:', e && e.message ? e.message : e)
      if (String(e && e.message || '').toLowerCase().includes('not found') || String(e && e.message || '').toLowerCase().includes('does not exist')) {
        console.error('\nBucket not found or inaccessible. Verify FIREBASE_STORAGE_BUCKET and that the service account has permission.\n')
      }
      throw e
    }

    const [meta] = await bucket.getMetadata()
    console.log('Resulting bucket.cors:')
    console.log(JSON.stringify(meta.cors || meta.Cors || [], null, 2))

    console.log('CORS update complete')
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err)
    process.exitCode = 2
  }
}

main()
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
