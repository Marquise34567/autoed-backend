const admin = require('firebase-admin')

// Support credentials provided either as a JSON string/path or as split env vars.
function loadServiceAccount() {
  const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT
  if (saEnv) {
    try {
      const raw = saEnv.trim()
      let json = raw
      if (!raw.startsWith('{') && require('fs').existsSync(raw)) {
        json = require('fs').readFileSync(raw, 'utf8')
      }
      const parsed = JSON.parse(json)
      if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n')
      return parsed
    } catch (e) {
      console.warn('[firebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON, falling through to split envs')
    }
  }

  // Fallback to split env vars
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY
  if (projectId && clientEmail && privateKeyRaw) {
    return { project_id: projectId, client_email: clientEmail, private_key: String(privateKeyRaw).replace(/\\n/g, '\n') }
  }

  return null
}

const serviceAccount = loadServiceAccount()
if (!serviceAccount) {
  throw new Error('Missing Firebase credentials: provide FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY')
}

function getBucketName() {
  const env = (process.env.FIREBASE_STORAGE_BUCKET || '').trim()
  if (env) return env.replace(/^gs:\/\//i, '')
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (projectId) return `${projectId}.appspot.com`
  return null
}

const derivedBucketName = getBucketName()

if (!admin.apps.length) {
  try {
    const initOptions = { credential: admin.credential.cert(serviceAccount) }
    if (derivedBucketName) initOptions.storageBucket = derivedBucketName
    admin.initializeApp(initOptions)
    console.log('[firebaseAdmin] initialized via Firebase credentials')
  } catch (e) {
    console.error('[firebaseAdmin] Failed to initialize Firebase Admin SDK:', e && e.message ? e.message : e)
    throw e
  }
}

// Setup bucket reference using derived bucket name
const rawBucket = derivedBucketName
let bucket = null
if (rawBucket) {
  try {
    bucket = admin.storage().bucket(rawBucket)
    ;(async () => {
      try {
        const [exists] = await bucket.exists()
        if (!exists) {
          if (String(process.env.FIREBASE_AUTO_CREATE_BUCKET).toLowerCase() === 'true') {
            console.warn(`[firebaseAdmin] Storage bucket does not exist: ${rawBucket} — attempting to create`)
            try {
              await admin.storage().bucket(rawBucket).create({
                location: process.env.GCS_BUCKET_LOCATION || 'US',
                storageClass: process.env.GCS_BUCKET_STORAGE_CLASS || 'STANDARD',
              })
              console.log(`[firebaseAdmin] Successfully created storage bucket: ${rawBucket}`)
            } catch (createErr) {
              console.error('[firebaseAdmin] Failed to create storage bucket:', createErr && createErr.message ? createErr.message : createErr)
            }
          } else {
            console.warn(`[firebaseAdmin] Storage bucket does not exist: ${rawBucket}. To auto-create set FIREBASE_AUTO_CREATE_BUCKET=true or create the bucket manually.`)
          }
        } else {
          console.log(`[firebaseAdmin] Storage bucket verified: ${rawBucket}`)
        }
      } catch (e) {
        console.error('[firebaseAdmin] Error checking storage bucket:', e && e.message ? e.message : e)
      }
    })()
  } catch (e) {
    console.error('[firebaseAdmin] Error initializing bucket:', e && e.message ? e.message : e)
    bucket = null
  }
}

// Startup log: indicate which bucket we will use
console.log('[firebaseAdmin] bucket:', rawBucket || 'MISSING')

// Export admin and helpers for convenience
const db = admin.firestore()
module.exports = admin
module.exports.db = db
module.exports.bucket = bucket
module.exports.getBucketName = function() {
  return rawBucket || null
}
module.exports.getBucket = function(name) {
  const effective = name || rawBucket
  if (!effective) throw new Error('FIREBASE_STORAGE_BUCKET missing and could not derive bucket name')
  return admin.storage().bucket(effective)
}
