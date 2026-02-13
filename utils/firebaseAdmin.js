const admin = require("firebase-admin");

function parseServiceAccountEnv() {
  const rawEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT
  if (!rawEnv) return null
  try {
    let raw = String(rawEnv).trim()
    // strip surrounding quotes if present
    if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
    const sa = JSON.parse(raw)
    if (!sa) return null
    if (sa.private_key) sa.private_key = String(sa.private_key).replace(/\\n/g, '\n')
    return sa
  } catch (err) {
    console.error('[firebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON', err && err.message ? err.message : err)
    return null
  }
}

if (!admin.apps.length) {
  // 1) Try service account JSON env first (sa JSON string)
  const sa = parseServiceAccountEnv()
  if (sa && sa.project_id && sa.client_email && sa.private_key) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: sa.project_id,
          clientEmail: sa.client_email,
          privateKey: sa.private_key,
        }),
      })
      console.log('[firebaseAdmin] initialized via FIREBASE_SERVICE_ACCOUNT_JSON')
    } catch (e) {
      console.error('[firebaseAdmin] Failed to initialize from FIREBASE_SERVICE_ACCOUNT_JSON', e && e.message ? e.message : e)
    }
  } else {
    // 2) Fallback to individual env vars
    const projectId = process.env.FIREBASE_PROJECT_ID
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
    const privateKey = process.env.FIREBASE_PRIVATE_KEY ? String(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n') : null

    if (!projectId || !clientEmail || !privateKey) {
      console.error('[firebaseAdmin] Missing required Firebase env vars for fallback initialization')
    } else {
      try {
        admin.initializeApp({
          credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
        })
        console.log('[firebaseAdmin] initialized via FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY')
      } catch (e) {
        console.error('[firebaseAdmin] Failed to initialize Firebase admin from env vars', e && e.message ? e.message : e)
      }
    }
  }
}

module.exports = admin;
