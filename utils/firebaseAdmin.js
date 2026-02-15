
// Initialize Firebase Admin strictly from environment variables only
const adminLib = require('firebase-admin')

// required envs
const REQUIRED_ENVS = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_STORAGE_BUCKET']
const missing = []
for (const k of REQUIRED_ENVS) if (!process.env[k] || !String(process.env[k]).trim()) missing.push(k)

if (missing.length) {
  console.error('[firebaseAdmin] Missing required env vars:', missing.join(', '))
  // Export a safe stub so requiring this module doesn't crash the whole server.
  const stub = {
    _missingEnv: missing,
    apps: [],
    initializeApp: () => {},
    credential: { cert: () => { throw new Error('Firebase not configured') } },
    auth: () => { throw new Error('Firebase not configured') },
    firestore: () => { throw new Error('Firebase not configured') },
    storage: () => { throw new Error('Firebase not configured') },
    getBucket: () => { throw new Error('FIREBASE_STORAGE_BUCKET not configured') },
    getBucketName: () => null,
    db: null,
  }
  module.exports = stub
} else {
  // safe parse private key with escaped newlines
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n')
  let storageBucket = String(process.env.FIREBASE_STORAGE_BUCKET).trim()

  // Normalize common bucket name typos and variants to expected formats so
  // signed URLs are generated against the real bucket. Examples seen in the
  // wild: "autoeditor-d4940.firestorage.app" (missing "base"). Normalize
  // to either the `.firebasestorage.app` or `.appspot.com` forms.
  try {
    const orig = storageBucket
    storageBucket = storageBucket.replace(/firestorage\.app$/i, 'firebasestorage.app')
    storageBucket = storageBucket.replace(/\.firestorage\./i, '.firebasestorage.')
    storageBucket = storageBucket.replace(/firestorage/i, 'firebasestorage')
    // If the bucket looks like just the project id (no dot), default to appspot.com
    if (!/\./.test(storageBucket)) {
      storageBucket = storageBucket + '.appspot.com'
    }
    if (storageBucket !== orig) console.warn('[firebaseAdmin] Normalized FIREBASE_STORAGE_BUCKET', orig, '->', storageBucket)
  } catch (e) {
    console.warn('[firebaseAdmin] bucket normalization failed', e && e.message)
  }

  const admin = adminLib
  if (!admin.apps.length) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey,
        }),
        storageBucket,
      })
      console.log('[firebaseAdmin] initialized with bucket:', storageBucket)
    } catch (e) {
      console.error('[firebaseAdmin] initializeApp failed', e && (e.stack || e.message || e))
      throw e
    }
  }

  const bucket = admin.storage().bucket(storageBucket)

  // attach helpers onto admin object for backward compatibility
  admin.getBucket = (name) => {
    const bn = name || storageBucket
    return admin.storage().bucket(bn)
  }
  admin.getBucketName = () => storageBucket

  module.exports = admin
  module.exports.getBucket = () => bucket
  module.exports.bucket = bucket
  module.exports.db = admin.firestore()
}
