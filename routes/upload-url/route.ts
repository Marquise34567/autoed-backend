import { NextResponse } from 'next/server'
import admin, { adminAuth, adminBucket, getBucket } from '@/lib/firebaseAdmin'
import path from 'path'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET || 'videos'
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024 // 2GB
const SIGNED_URL_EXPIRES_IN = 3600 // 1 hour in seconds

/**
 * Check if all required environment variables are set
 */
function getMissingEnvVars(): string[] {
  const missing: string[] = []
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)) missing.push('FIREBASE_SERVICE_ACCOUNT or FIREBASE_* vars')
  if (!process.env.FIREBASE_STORAGE_BUCKET) missing.push('FIREBASE_STORAGE_BUCKET')
  return missing
}

export async function POST(request: Request) {
  const requestId = randomUUID()
  const logPrefix = `[upload-url:${requestId}]`

  try {
    console.log(`${logPrefix} POST /api/upload-url started`)

    // Step 1: Check environment variables
    const missingEnv = getMissingEnvVars()
    if (missingEnv.length > 0) {
      console.error(`${logPrefix} Missing env vars:`, missingEnv)
      return NextResponse.json(
        {
          error: 'Server misconfiguration',
          details: `Missing environment variables: ${missingEnv.join(', ')}`,
          missingEnv,
          bucketExists: null,
        },
        { status: 500 }
      )
    }

    // Step 2: Authenticate user
    console.log(`${logPrefix} Authenticating user via Firebase session cookie...`)
    const cookieStore = await cookies()
    const session = cookieStore.get('session')?.value

    if (!session) {
      console.error(`${logPrefix} No session cookie`)
      return NextResponse.json({ error: 'Not authenticated', details: 'No session cookie' }, { status: 401 })
    }

    let decoded: any
    try {
      decoded = await adminAuth.verifySessionCookie(session, true)
    } catch (e: any) {
      console.error(`${logPrefix} Failed to verify session cookie:`, e?.message || e)
      return NextResponse.json({ error: 'Not authenticated', details: 'Invalid session cookie' }, { status: 401 })
    }

    const userId = decoded?.uid
    if (!userId) {
      console.error(`${logPrefix} No user id in session cookie`)
      return NextResponse.json({ error: 'Not authenticated', details: 'Invalid session payload' }, { status: 401 })
    }

    console.log(`${logPrefix} User authenticated:`, userId)

    // Step 3: Parse request body
    console.log(`${logPrefix} Parsing request body...`)
    let body: { filename: string; contentType: string; size?: number }
    try {
      body = (await request.json()) as typeof body
    } catch (e) {
      console.error(`${logPrefix} Invalid JSON:`, e)
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: 'Request body must be valid JSON with filename and contentType',
          missingEnv: [],
          bucketExists: null,
        },
        { status: 400 }
      )
    }

    const { filename, contentType, size } = body

    // Validate required fields
    if (!filename || !contentType) {
      console.error(`${logPrefix} Missing required fields: filename=${!!filename}, contentType=${!!contentType}`)
      return NextResponse.json(
        {
          error: 'Missing required fields',
          details: 'filename and contentType are required',
          missingEnv: [],
          bucketExists: null,
        },
        { status: 400 }
      )
    }

    // Validate video MIME type
    if (!contentType.startsWith('video/')) {
      console.error(`${logPrefix} Invalid content type:`, contentType)
      return NextResponse.json(
        {
          error: 'Invalid content type',
          details: `Content type must be a video MIME type (e.g., video/mp4), got: ${contentType}`,
          missingEnv: [],
          bucketExists: null,
        },
        { status: 400 }
      )
    }

    // Validate file size (client-side should also validate)
    if (size && size > MAX_FILE_SIZE) {
      console.error(`${logPrefix} File too large:`, size, `> ${MAX_FILE_SIZE}`)
      return NextResponse.json(
        {
          error: 'File too large',
          details: `File size must be less than 2GB, got: ${(size / 1024 / 1024 / 1024).toFixed(2)}GB`,
          missingEnv: [],
          bucketExists: null,
        },
        { status: 413 }
      )
    }

    // Step 4: Create admin client
    // Step 5: Ensure bucket exists (Firebase Storage)
    console.log(`${logPrefix} Checking Firebase storage bucket '${BUCKET_NAME}'...`)
      const bucket = getBucket(BUCKET_NAME)
    try {
      const [exists] = await bucket.exists()
      if (!exists) {
        console.error(`${logPrefix} Bucket does not exist: ${BUCKET_NAME}`)
        return NextResponse.json(
          {
            error: 'Bucket unavailable',
              details: `Bucket '${BUCKET_NAME}' does not exist. Verify FIREBASE_STORAGE_BUCKET and that your Firebase project contains this bucket.`,
            missingEnv: [],
            bucketExists: false,
              projectId: process.env.FIREBASE_PROJECT_ID || null,
          },
          { status: 500 }
        )
      }
      console.log(logPrefix + " \u2713 Bucket exists")
    } catch (e: any) {
      console.error(logPrefix + " Error checking bucket:", e?.message ?? e)
      return NextResponse.json(
        {
          error: 'Bucket check failed',
          details: e?.message || String(e),
          missingEnv: [],
          bucketExists: null,
            projectId: process.env.FIREBASE_PROJECT_ID || null,
        },
        { status: 500 }
      )
    }

    // Step 6: Generate canonical storage path (uploads/{uid}/{jobId}/original.<ext>)
    console.log(`${logPrefix} Generating storage path...`)
    const jobId = (body as any).jobId || randomUUID()
    const ext = path.extname(filename) || ''
    const safeBase = path.basename(filename, ext).replace(/[^a-zA-Z0-9._-]/g, '_')
    const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '')
    const storagePath = `uploads/${userId}/${jobId}/original${safeExt ? safeExt : ''}`
    console.log(`${logPrefix} Storage path:`, storagePath)

    // Step 7: Create signed upload URL using GCS signed URL (v4)
    try {
      const file = bucket.file(storagePath)
      const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRES_IN * 1000)
      const [signedUrl] = await file.getSignedUrl({ version: 'v4', action: 'write', expires: expiresAt })

      console.log(`${logPrefix} ✓ Signed URL created successfully`)
      return NextResponse.json({ signedUrl, path: storagePath, jobId, tokenExpiresIn: SIGNED_URL_EXPIRES_IN }, { status: 200 })
    } catch (e: any) {
      console.error(`${logPrefix} Failed to create signed upload URL:`, e?.message || e)
      return NextResponse.json({ error: 'Failed to generate upload URL', details: e?.message || String(e) }, { status: 500 })
    }
  } catch (error) {
    console.error(`${logPrefix} Unhandled error:`, error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : JSON.stringify(error),
        missingEnv: getMissingEnvVars(),
        bucketExists: null,
      },
      { status: 500 }
    )
  }
}
