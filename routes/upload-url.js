const express = require('express')
const mimeLib = require('mime-types')
const router = express.Router()
const fs = require('fs')
const { Storage } = require('@google-cloud/storage')

function loadServiceAccount() {
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
let storageClient = null
if (serviceAccount) storageClient = new Storage({ credentials: serviceAccount })

/*
  Test with curl:
  curl -X POST https://your-backend.example.com/api/upload-url \
    -H "Content-Type: application/json" \
    -d '{"filename":"video.mp4","contentType":"video/mp4"}'

  Response: { ok:true, signedUrl:"<PUT_URL>", path:"uploads/<ts>-video.mp4", bucket:"<bucket-name>" }
*/

router.post('/', async (req, res) => {
  const requestId = Date.now() + ':' + Math.floor(Math.random() * 10000)
  try {
    const { fileName, contentType, filename, mime, enforceContentType } = req.body || {}
    // support both fileName and filename param names
    const finalName = fileName || filename
    // Log contentType for validation
    console.log(`[upload-url:${requestId}] request body:`, { fileName: finalName, contentType, enforceContentType })
    console.log(`[upload-url:${requestId}] contentType used for signing:`, contentType || 'application/octet-stream')

    if (!finalName) {
      return res.status(400).json({ error: 'Missing fileName' })
    }

    const bucketName = process.env.FIREBASE_STORAGE_BUCKET
    if (!bucketName) {
      console.error(`[upload-url:${requestId}] FIREBASE_STORAGE_BUCKET is not set`)
      return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET is not set' })
    }
    if (!storageClient) {
      console.error(`[upload-url:${requestId}] service account credentials not found; cannot sign URLs`)
      return res.status(500).json({ error: 'Service account credentials not configured' })
    }
    const bucket = storageClient.bucket(bucketName)

    // generate unique, safe path
    const safeFilename = String(finalName).replace(/[^a-zA-Z0-9._-]/g, '_')
    const destPath = `uploads/${Date.now()}-${safeFilename}`

    const file = bucket.file(destPath)
    const expiresAt = Date.now() + 15 * 60 * 1000 // milliseconds since epoch

    // Create v4 signed URL for write (PUT). Sign Content-Type to match browser PUT.
    const ct = contentType || 'application/octet-stream'
    // Log contentType before signing
    console.log(`[upload-url:${requestId}] getSignedUrl contentType:`, ct)
    // Use EXACT value from frontend, no transformation
    const [uploadUrl] = await file.getSignedUrl({ version: 'v4', action: 'write', expires: expiresAt, contentType: contentType || 'application/octet-stream' })

    // Log query params helpful for debugging SignatureDoesNotMatch
    try {
      const u = new URL(uploadUrl)
      const sig = u.searchParams.get('X-Goog-Signature')
      const signedHeaders = u.searchParams.get('X-Goog-SignedHeaders')
      console.log(`[upload-url:${requestId}] signedUrl generated: path=${destPath} bucket=${bucket.name} X-Goog-Signature=${sig ? sig.slice(0,8)+'...' : '<missing>'} X-Goog-SignedHeaders=${signedHeaders}`)
    } catch (e) {
      console.log(`[upload-url:${requestId}] signedUrl generated (unable to parse query params)`)
    }

    return res.status(200).json({ uploadUrl, filePath: destPath, expiresAt })
  } catch (err) {
    console.error(`[upload-url:${requestId}] handler error`, err && (err.stack || err.message || err))
    return res.status(500).json({ error: 'Failed to create signed URL' })
  }
})

// Preflight handled globally by CORS middleware

module.exports = router
