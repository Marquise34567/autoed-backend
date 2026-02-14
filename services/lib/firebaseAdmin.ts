import admin from 'firebase-admin'

function getCredential() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY
  const missing: string[] = []
  if (!projectId) missing.push('FIREBASE_PROJECT_ID')
  if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL')
  if (!privateKeyRaw) missing.push('FIREBASE_PRIVATE_KEY')
  if (missing.length) {
    throw new Error(`Missing required Firebase environment variables: ${missing.join(', ')}`)
  }
  const privateKey = String(privateKeyRaw).replace(/\\n/g, '\n')
  return admin.credential.cert({ projectId, clientEmail, privateKey })
}

// Derive bucket name: prefer explicit env, else <PROJECT_ID>.appspot.com
function getBucketName(): string | null {
  const envBucket = (process.env.FIREBASE_STORAGE_BUCKET || '').trim()
  if (envBucket) return envBucket.replace(/^gs:\/\//i, '')
  const pid = process.env.FIREBASE_PROJECT_ID
  if (pid) return `${pid}.appspot.com`
  return null
}

if (!admin.apps.length) {
  try {
    const credential = getCredential()
    const storageBucket = getBucketName() || undefined
    admin.initializeApp({ credential, storageBucket })
    if (storageBucket) console.log('[services/lib/firebaseAdmin] initialized with storageBucket:', storageBucket)
    else console.log('[services/lib/firebaseAdmin] initialized without storageBucket')
  } catch (e) {
    console.error('[services/lib/firebaseAdmin] Firebase initialization failed:', e && e.message ? e.message : e)
    throw e
  }
}

export const adminAuth = admin.auth()
export const adminDb = admin.firestore()

// Helper to get a bucket instance. Prefer explicit name argument, then
// environment-derived bucket, then throw if none available.
export function getBucket(name?: string) {
  const bucketName = name || getBucketName()
  if (!bucketName) throw new Error('FIREBASE_STORAGE_BUCKET not configured and could not derive bucket name')
  return admin.storage().bucket(bucketName)
}

export { getBucketName }

export default admin
