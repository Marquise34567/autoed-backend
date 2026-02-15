"use client"

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const REQUIRED = ["NEXT_PUBLIC_FIREBASE_API_KEY", "NEXT_PUBLIC_FIREBASE_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"];

let cachedApp: ReturnType<typeof getApp> | null = null

function getFirebaseConfig() {
  // Avoid dynamic process.env access on the client; Next.js only inlines
  // explicit NEXT_PUBLIC_* references at build time.
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? ""
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? ""
  const missing: string[] = []
  const storageBucket = (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '').trim()

  if (!apiKey.trim()) missing.push("NEXT_PUBLIC_FIREBASE_API_KEY")
  if (!projectId.trim()) missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID")
  if (!storageBucket) missing.push("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET")

  if (storageBucket.includes('gs://')) {
    const msg = 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET must NOT include the "gs://" prefix. Remove it from your .env.local and restart.'
    console.error(msg)
    throw new Error(msg)
  }

  if (missing.length) {
    const msg = `Missing required environment variable(s) for Firebase client initialization: ${missing.join(", ")}. Add them to your .env.local and restart the dev server.`
    console.error(msg)
    throw new Error(msg)
  }

  return {
    apiKey,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  }
}

export function getAppInstance() {
  if (cachedApp) return cachedApp
  const config = getFirebaseConfig()
  cachedApp = getApps().length ? getApp() : initializeApp(config)

  // Dev-only runtime debug to verify the project/bucket used by the initialized app
  if (process.env.NODE_ENV === 'development') {
    try {
      const app = cachedApp as any
      // app.options should contain projectId and storageBucket
      console.log('firebase projectId:', app.options?.projectId)
      console.log('firebase storageBucket:', app.options?.storageBucket)
    } catch (e) {
      console.warn('Unable to print firebase app options for debugging', e)
    }
  }

  return cachedApp
}

export function getAuthInstance() {
  const app = getAppInstance()
  return getAuth(app)
}

export function getDbInstance() {
  const app = getAppInstance()
  return getFirestore(app)
}

export function getStorageInstance() {
  const app = getAppInstance()
  return getStorage(app)
}

export default {
  getAppInstance,
  getAuthInstance,
  getDbInstance,
  getStorageInstance,
}
