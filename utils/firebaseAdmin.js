
const admin = require('firebase-admin');

const rawServiceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const rawStorageBucket = process.env.FIREBASE_STORAGE_BUCKET;
const serviceAccountJson = rawServiceAccountJson && rawServiceAccountJson.trim();
const storageBucket = rawStorageBucket && String(rawStorageBucket).trim();

// Prefer explicit env vars for single-line private key setup
const projectIdEnv = process.env.FIREBASE_PROJECT_ID
const clientEmailEnv = process.env.FIREBASE_CLIENT_EMAIL
const privateKeyEnv = process.env.FIREBASE_PRIVATE_KEY

function getBucketName() {
  if (!storageBucket) return null
  // allow values like 'gs://bucket/name' or plain bucket name
  // strip optional surrounding quotes and gs:// prefix
  const stripped = storageBucket.replace(/^"|"$/g, '').replace(/^'|'$/g, '')
  return stripped.replace(/^gs:\/\//i, '').trim()
}

// Validate and build credential
let credential = null
if (projectIdEnv && clientEmailEnv && privateKeyEnv) {
  // Use the three env vars method (handles escaped newlines)
  credential = admin.credential.cert({
    projectId: projectIdEnv,
    clientEmail: clientEmailEnv,
    privateKey: String(privateKeyEnv).replace(/\\n/g, '\n'),
  })
} else if (serviceAccountJson) {
  let serviceAccount
  try {
    serviceAccount = JSON.parse(serviceAccountJson)
  } catch (e) {
    throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: ' + (e && e.message ? e.message : String(e)))
  }
  if (serviceAccount.private_key) {
    serviceAccount.private_key = String(serviceAccount.private_key).replace(/\\n/g, '\n')
  }
  credential = admin.credential.cert(serviceAccount)
} else {
  throw new Error('Firebase credentials not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY or FIREBASE_SERVICE_ACCOUNT_JSON')
}

if (!storageBucket) {
  throw new Error('FIREBASE_STORAGE_BUCKET is required to initialize Firebase Admin')
}

// Initialize admin app only once
if (!admin.apps || !admin.apps.length) {
  admin.initializeApp({
    credential: credential,
    storageBucket: getBucketName(),
  })
  console.log('[firebaseAdmin] initialized with bucket:', getBucketName())
}

let bucket = null
try {
  bucket = admin.storage().bucket(getBucketName())
} catch (e) {
  console.warn('[firebaseAdmin] failed to get bucket:', e && e.message ? e.message : e)
  bucket = null
}

module.exports = admin
module.exports.adminAuth = admin.auth()
module.exports.bucket = bucket
module.exports.getBucket = function(name) {
  const bn = name || getBucketName()
  if (!bn) throw new Error('FIREBASE_STORAGE_BUCKET not configured')
  return admin.storage().bucket(bn)
}
module.exports.getBucketName = getBucketName
module.exports.db = admin.firestore()
