const admin = require('firebase-admin')

function parseServiceAccount() {
  const env = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT
  if (!env) return null
  try {
    const raw = env.trim()
    const unq = (raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"')) ? raw.slice(1, -1) : raw
    const svc = JSON.parse(unq)
    if (svc.private_key) svc.private_key = svc.private_key.replace(/\\n/g, '\n')
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
    return null
  }
  const privateKey = String(privateKeyRaw).replace(/\\n/g, '\n')
  return admin.credential.cert({ projectId, clientEmail, privateKey })
}

if (!admin.apps.length) {
  const credential = getCredential()
  if (credential) {
    // Determine storage bucket: prefer explicit env var, fallback to <projectId>.appspot.com
    const explicitBucket = process.env.FIREBASE_STORAGE_BUCKET || undefined
    const fallbackBucket = process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.appspot.com` : undefined
    const storageBucket = explicitBucket || fallbackBucket || undefined

    const initOpts = { credential }
    if (storageBucket) initOpts.storageBucket = storageBucket

    try {
      admin.initializeApp(initOpts)
      console.log('[firebaseAdmin] initialized', { storageBucket: storageBucket || null })
    } catch (e) {
      console.warn('[firebaseAdmin] initializeApp failed', e && e.message)
    }
  } else {
    console.warn('Missing Firebase service account environment variables — Firebase admin not initialized')
  }
}

module.exports = admin
