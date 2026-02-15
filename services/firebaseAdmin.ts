import admin from 'firebase-admin'

function getCredential() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY
  const missing = [] as string[]
  if (!projectId) missing.push('FIREBASE_PROJECT_ID')
  if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL')
  if (!privateKeyRaw) missing.push('FIREBASE_PRIVATE_KEY')
  if (missing.length) {
    throw new Error(`Missing required Firebase environment variables: ${missing.join(', ')}`)
  }
  const privateKey = String(privateKeyRaw).replace(/\\n/g, '\n')
  return admin.credential.cert({ projectId, clientEmail, privateKey })
}

if (!admin.apps.length) {
  try {
    const credential = getCredential()
    admin.initializeApp({ credential })
  } catch (e) {
    console.error('[services/firebaseAdmin] Firebase initialization failed:', e && e.message ? e.message : e)
    throw e
  }
}

export const adminAuth = admin.auth()
export const adminDb = admin.firestore()

export default admin

// Provide a helper to obtain Firestore instance (avoid accidental double-inits elsewhere)
export function getFirestore() {
  return admin.firestore()
}

// Promise timeout helper to avoid Firestore calls hanging indefinitely
export function withTimeout<T>(p: Promise<T>, ms = 10000): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error('Firestore operation timed out')), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>
}

// Global process handlers to surface unhandled errors in logs
process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED_REJECTION]', err)
})

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT_EXCEPTION]', err)
})
