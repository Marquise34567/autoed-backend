
const admin = require('firebase-admin');

const rawServiceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const rawStorageBucket = process.env.FIREBASE_STORAGE_BUCKET;
const serviceAccountJson = rawServiceAccountJson && rawServiceAccountJson.trim();
const storageBucket = rawStorageBucket && String(rawStorageBucket).trim();

function getBucketName() {
  if (!storageBucket) return null
  // allow values like 'gs://bucket/name' or plain bucket name
  // strip optional surrounding quotes and gs:// prefix
  const stripped = storageBucket.replace(/^"|"$/g, '').replace(/^'|'$/g, '')
  return stripped.replace(/^gs:\/\//i, '').trim()
}

// Validate required env vars
if (!serviceAccountJson) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required to initialize Firebase Admin')
}
if (!storageBucket) {
  throw new Error('FIREBASE_STORAGE_BUCKET is required to initialize Firebase Admin')
}

let serviceAccount
try {
  serviceAccount = JSON.parse(serviceAccountJson)
} catch (e) {
  throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: ' + (e && e.message ? e.message : String(e)))
}

if (serviceAccount.private_key) {
  serviceAccount.private_key = String(serviceAccount.private_key).replace(/\\n/g, '\n')
}

// Initialize admin app only once
if (!admin.apps || !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
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
