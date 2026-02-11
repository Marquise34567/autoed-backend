import admin from 'firebase-admin'

function parseServiceAccount(): admin.ServiceAccount | null {
  const env = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT
  if (!env) return null
  try {
    const raw = env.trim()
    const unq = (raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"')) ? raw.slice(1, -1) : raw
    const svc = JSON.parse(unq) as admin.ServiceAccount
    if (svc.private_key) {
      svc.private_key = svc.private_key.replace(/\\n/g, '\n')
    }
    return svc
  } catch (e) {
    console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', e)
    return null
  }
}

function getCredential() {
  const svc = parseServiceAccount()
  if (svc && svc.private_key && svc.client_email) return admin.credential.cert(svc)

  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY
  if (!projectId || !clientEmail || !privateKeyRaw) {
    throw new Error('Missing Firebase service account environment variables')
  }
  const privateKey = String(privateKeyRaw).replace(/\\n/g, '\n')
  return admin.credential.cert({ projectId, clientEmail, privateKey })
}

if (!admin.apps.length) {
  const credential = getCredential()
  admin.initializeApp({ credential })
}

export const adminAuth = admin.auth()
export const adminDb = admin.firestore()

export default admin
