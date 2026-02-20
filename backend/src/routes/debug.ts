import express from 'express'
import { testConnection } from '../db/prisma'
import { getBucket } from '../firebaseAdmin'

const router = express.Router()

router.get('/debug/env', (req, res) => {
  res.json({
    ok: true,
    env: {
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasFirebaseKey: Boolean(process.env.FIREBASE_PRIVATE_KEY),
      hasStorageBucket: Boolean(process.env.FIREBASE_STORAGE_BUCKET)
    }
  })
})

router.get('/debug/db', async (req, res) => {
  const ok = await testConnection()
  res.json({ ok, db: ok ? 'ok' : 'fail' })
})

router.get('/debug/storage', async (req, res) => {
  try {
    const bucket = getBucket()
    const [exists] = await bucket.exists()
    res.json({ ok: true, bucketExists: exists })
  } catch (e) {
    res.json({ ok: false, error: String(e && e.message) })
  }
})

export default router
