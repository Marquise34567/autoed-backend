const admin = require('firebase-admin')
const fs = require('fs')

function getBucketNameFromEnv() {
  const raw = process.env.FIREBASE_STORAGE_BUCKET || ''
  if (!raw) return null
  const s = String(raw).trim()
  const stripped = s.replace(/^"|"$/g, '').replace(/^'|'$/g, '')
  return stripped.replace(/^gs:\/\//i, '').trim() || null
}

function readServiceAccountFromEnv() {
  const candidates = [
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    process.env.FIREBASE_SERVICE_ACCOUNT,
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
  ].filter(Boolean)

  if (!candidates.length) return null

  // If no env var provided, try to auto-discover a local service account file
  try {
    const cwdFiles = fs.readdirSync(process.cwd())
    const found = cwdFiles.find(f => /firebase-adminsdk.*\.json$/i.test(f))
    if (found) {
      const p = require('path').resolve(process.cwd(), found)
      try {
        const txt = fs.readFileSync(p, 'utf8')
        const parsed = JSON.parse(txt)
        if (parsed && parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n')
        return parsed
      } catch (e) {
        // ignore and continue
      }
    }
  } catch (e) {
    // ignore
  }

  for (const raw of candidates) {
    let value = String(raw).trim()
    // If value looks like a path (doesn't start with '{'), try to read file
    if (!value.startsWith('{')) {
      try {
        if (fs.existsSync(value)) {
          value = fs.readFileSync(value, 'utf8')
        }
      } catch (e) {
        // ignore and try parse below
      }
    }
    try {
      const parsed = JSON.parse(value)
      if (parsed && parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n')
      return parsed
    } catch (e) {
      // not JSON, continue to next candidate
    }
  }
  return null
}

function getCredentialFromSplitEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY
  if (!projectId || !clientEmail || !privateKeyRaw) return null
  return {
    projectId,
    clientEmail,
    private_key: String(privateKeyRaw).replace(/\\n/g, '\n'),
  }
}

function initFirebaseAdmin() {
  if (admin.apps && admin.apps.length) {
    const bn = getBucketNameFromEnv()
    return { admin, db: admin.firestore(), bucket: bn ? admin.storage().bucket(bn) : admin.storage().bucket() }
  }

  const svc = readServiceAccountFromEnv()
  let credential = null
  if (svc) {
    credential = admin.credential.cert(svc)
  } else {
    const split = getCredentialFromSplitEnv()
    if (split) credential = admin.credential.cert(split)
  }

  if (!credential) {
    const missingMsg = 'Missing required env vars: provide FIREBASE_SERVICE_ACCOUNT_JSON (or GOOGLE_APPLICATION_CREDENTIALS path) or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY'
    console.error('[services/firebaseAdmin] ' + missingMsg)
    throw new Error(missingMsg)
  }

  const bucketName = getBucketNameFromEnv() || 'autoeditor-d4940.firebasestorage.app'

  admin.initializeApp({ credential, storageBucket: bucketName })
  console.log('[firebaseAdmin] initialized with storageBucket:', bucketName)
  // Use explicit bucket name to avoid ambiguity
  const db = admin.firestore()
  const bucket = admin.storage().bucket(bucketName)
  console.log('[firebaseAdmin] bucket:', process.env.FIREBASE_STORAGE_BUCKET)
  console.log('[firebaseAdmin] db defined:', !!db)
  return { admin, db, bucket, getBucketName: () => bucketName, getBucket: () => bucket }
 }

module.exports = initFirebaseAdmin()
