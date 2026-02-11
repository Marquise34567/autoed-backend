import admin from 'firebase-admin'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

// Initialize firebase-admin once and fail loudly if misconfigured
let initialized = false
try {
  const projectId = requireEnv('FIREBASE_PROJECT_ID')
  const clientEmail = requireEnv('FIREBASE_CLIENT_EMAIL')
  let privateKey = requireEnv('FIREBASE_PRIVATE_KEY')

  // Private key in env should contain literal \n sequences; convert to real newlines
  privateKey = privateKey.replace(/\\n/g, '\n')

  // Avoid double initialization
  const apps = (admin as any).apps || []
  if (apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    })
  }

  initialized = true
  console.log('[firebase:admin] Initialized')
} catch (e) {
  // Fail loudly on server start in dev to help debugging
  console.error('[firebase:admin] Initialization error:', e instanceof Error ? e.message : e)
}

export function getAdminAuth() {
  if (!initialized) throw new Error('firebase-admin not initialized. Check FIREBASE_* env vars')
  return admin.auth()
}

export const isAdminInitialized = initialized

export default admin
