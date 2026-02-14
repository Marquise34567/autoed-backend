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

if (!admin.apps.length) {
  try {
    const credential = getCredential()
    admin.initializeApp({ credential })
  } catch (e) {
    console.error('[services/lib/firebaseAdmin] Firebase initialization failed:', e && e.message ? e.message : e)
    throw e
  }
}

export const adminAuth = admin.auth()
export const adminDb = admin.firestore()

export default admin
