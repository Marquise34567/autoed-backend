import { NextRequest, NextResponse } from 'next/server'
import admin from '@/lib/firebaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/video/download-session
 * Body: { jobId: string }
 * Authorization: Bearer <idToken>
 * Returns: { token: string }
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || ''
    const match = authHeader.match(/^Bearer (.+)$/)
    if (!match) return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 })
    const idToken = match[1]

    // Verify ID token
    let decoded: any
    try {
      decoded = await admin.auth().verifyIdToken(idToken)
    } catch (e) {
      return NextResponse.json({ error: 'Invalid ID token' }, { status: 401 })
    }
    const uid = decoded.uid as string
    if (!uid) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const jobId = String(body?.jobId || '')
    if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 })

    const db = admin.firestore()

    // Try jobs/{jobId} first, then users/{uid}/jobs/{jobId}
    let jobRef = db.collection('jobs').doc(jobId)
    let jobSnap = await jobRef.get()
    if (!jobSnap.exists) {
      jobRef = db.collection('users').doc(uid).collection('jobs').doc(jobId)
      jobSnap = await jobRef.get()
    }
    if (!jobSnap.exists) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const job = jobSnap.data() as any
    if (!job || job.uid !== uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    const finalVideoPath = typeof job.finalVideoPath === 'string' && job.finalVideoPath
      ? job.finalVideoPath
      : (typeof job.objectPathOutput === 'string' ? job.objectPathOutput : '')
    if (!finalVideoPath) return NextResponse.json({ error: 'No finalVideoPath for job' }, { status: 400 })
    if (looksLikeUrl(finalVideoPath)) {
      return NextResponse.json({ error: 'Invalid finalVideoPath' }, { status: 400 })
    }

    if (!job.finalVideoPath && finalVideoPath) {
      try {
        await jobRef.set(
          {
            finalVideoPath,
            objectPathOutput: admin.firestore.FieldValue.delete(),
          },
          { merge: true }
        )
      } catch (_) {}
    }

    // Create token and persist
    const token = cryptoRandom()
    const now = new Date()
    const expiresAt = admin.firestore.Timestamp.fromDate(new Date(now.getTime() + 10 * 60 * 1000)) // 10 minutes

    const tokenRef = db.collection('downloadTokens').doc(token)
    await tokenRef.set({
      uid,
      jobId,
      finalVideoPath,
      fileName: job.fileName || `autoeditor-${jobId}.mp4`,
      mimeType: job.mimeType || 'video/mp4',
      used: false,
      expiresAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    return NextResponse.json({ token })
  } catch (err) {
    console.error('[download-session] Error creating token', err)
    return NextResponse.json({ error: 'Failed to create download session' }, { status: 500 })
  }
}

function cryptoRandom() {
  try {
    // prefer crypto.randomUUID when available
    // @ts-ignore
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch (e) {}
  const { randomBytes } = require('crypto')
  return randomBytes(16).toString('hex')
}

function looksLikeUrl(value: string) {
  const v = value.trim()
  if (!v) return false
  if (v.includes('?')) return true
  return (
    v.includes('http://') ||
    v.includes('https://') ||
    v.includes('storage.googleapis.com') ||
    v.includes('GoogleAccessId=') ||
    v.includes('X-Goog-Algorithm') ||
    v.includes('X-Goog-Credential') ||
    v.includes('X-Goog-Signature')
  )
}
