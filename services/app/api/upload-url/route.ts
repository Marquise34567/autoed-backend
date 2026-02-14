import { NextResponse } from 'next/server'
import admin, { adminAuth } from '@/lib/firebaseAdmin'
// Use @google-cloud/storage directly for signing URLs to avoid Firebase SDK signed headers
const { Storage } = require('@google-cloud/storage')
const fs = require('fs')
import path from 'path'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Do not use a meaningless fallback; derive bucketName from env or project id
const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET || (process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.appspot.com` : null)
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024 // 2GB
const SIGNED_URL_EXPIRES_IN = 3600 // 1 hour in seconds

function loadServiceAccount(): any | null {
  const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT
  if (saEnv) {
    try {
      let raw = saEnv.trim()
      if (!raw.startsWith('{') && fs.existsSync(raw)) raw = fs.readFileSync(raw, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n')
      return parsed
    } catch (e) {
      console.warn('[upload-url] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON')
    }
  }
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY
  if (projectId && clientEmail && privateKeyRaw) return { project_id: projectId, client_email: clientEmail, private_key: String(privateKeyRaw).replace(/\\n/g, '\n') }
  return null
}

const serviceAccount = loadServiceAccount()
const storageClient = serviceAccount ? new Storage({ credentials: serviceAccount }) : null

/**
 * Check if all required environment variables are set
 */
function getMissingEnvVars(): string[] {
  const missing: string[] = []
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)) missing.push('FIREBASE_SERVICE_ACCOUNT or FIREBASE_* vars')
  return missing
}

export async function POST(request: Request) {
  const requestId = randomUUID()
  const logPrefix = `[upload-url:${requestId}]`

  try {
    console.log(`${logPrefix} POST /api/upload-url started`)
    // Step 1: Check environment variables (credentials only)
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
    let body: { filename: string; contentType?: string; size?: number }
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

    // Validate required fields (only filename required). contentType is optional
    // Log contentType for validation
    console.log(`${logPrefix} contentType received:`, contentType)
    if (!filename) {
      console.error(`${logPrefix} Missing required field: filename`)
      return NextResponse.json(
        {
          error: 'Missing required fields',
          details: 'filename is required',
          missingEnv: [],
          bucketExists: null,
        },
        { status: 400 }
      )
    }

    // If contentType provided, ensure it's a video MIME type; otherwise allow.
    if (contentType && !contentType.startsWith('video/')) {
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
    let bucket
    try {
      if (!BUCKET_NAME) {
        throw new Error('FIREBASE_STORAGE_BUCKET not configured and FIREBASE_PROJECT_ID missing')
      }
      bucket = admin.storage().bucket(BUCKET_NAME)
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
      return NextResponse.json({ ok: false, error: 'FIREBASE_STORAGE_BUCKET missing' }, { status: 500 })
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
      if (!storageClient) {
        console.error(`${logPrefix} service account not available for signing URLs`)
        return NextResponse.json({ error: 'Service account not configured' }, { status: 500 })
      }
      const bucket = storageClient.bucket(BUCKET_NAME)
      const file = bucket.file(storagePath)
      const expiresAt = Date.now() + SIGNED_URL_EXPIRES_IN * 1000 // milliseconds since epoch

      // Create V4 signed URL for write (PUT). Sign Content-Type so browser PUT matches.
      const contentTypeHeader = contentType || 'application/octet-stream'
      // Log contentType before signing
      console.log(`${logPrefix} getSignedUrl contentType:`, contentTypeHeader)
      const [uploadUrl] = await file.getSignedUrl({ version: 'v4', action: 'write', expires: expiresAt, contentType: contentTypeHeader })

      // Log query params for debugging
      try {
        const u = new URL(uploadUrl)
        const sig = u.searchParams.get('X-Goog-Signature')
        const signedHeaders = u.searchParams.get('X-Goog-SignedHeaders')
        console.log(`${logPrefix} Signed URL: path=${storagePath} X-Goog-Signature=${sig ? sig.slice(0,8)+'...' : '<missing>'} X-Goog-SignedHeaders=${signedHeaders}`)
      } catch (e) {
        console.log(`${logPrefix} Signed URL created (unable to parse query params)`)
      }

      return NextResponse.json({ uploadUrl, filePath: storagePath, expiresAt, jobId, tokenExpiresIn: SIGNED_URL_EXPIRES_IN }, { status: 200 })
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
