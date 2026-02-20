import admin from 'firebase-admin'
import { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_STORAGE_BUCKET } from './env'

let initialized = false

export function initFirebase() {
  if (initialized) return admin
  const creds = {
    projectId: FIREBASE_PROJECT_ID || undefined,
    clientEmail: FIREBASE_CLIENT_EMAIL || undefined,
    privateKey: FIREBASE_PRIVATE_KEY || undefined
  }
  try {
    if (creds.clientEmail && creds.privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: creds.projectId,
          clientEmail: creds.clientEmail,
          privateKey: creds.privateKey
        }),
        storageBucket: FIREBASE_STORAGE_BUCKET || undefined
      })
    } else {
      admin.initializeApp({ storageBucket: FIREBASE_STORAGE_BUCKET || undefined })
    }
    initialized = true
  } catch (e) {
    console.warn('[firebase] initialization warning', e)
  }
  return admin
}

export function getAdminAuth() {
  initFirebase()
  return admin.auth()
}

export function getBucket() {
  initFirebase()
  return admin.storage().bucket()
}
