import dotenv from 'dotenv'
dotenv.config()

export const PORT = process.env.PORT ? Number(process.env.PORT) : 8080
export const DATABASE_URL = process.env.DATABASE_URL || ''
export const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || ''
export const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || ''
export const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : ''
export const FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || ''
export const WORKER_ENABLED = String(process.env.WORKER_ENABLED || 'false') === 'true'
