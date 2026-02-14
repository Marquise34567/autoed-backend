const express = require('express')
const mimeLib = require('mime-types')
const router = express.Router()

const fs = require('fs')
let admin = null
try { admin = require('../../utils/firebaseAdmin') } catch (e) { admin = null }
const { Storage } = require('@google-cloud/storage')

const http = require('http')
const https = require('https')
const { URL } = require('url')

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
      /* ignore */
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

function putToSignedUrl(signedUrl, body, ct) {
  const u = new URL(signedUrl)
  const lib = u.protocol === 'https:' ? https : http
  const headers = { 'Content-Length': Buffer.byteLength(body) }
  if (ct) headers['Content-Type'] = ct
  const opts = { method: 'PUT', headers }
  return new Promise((resolve, reject) => {
    const req = lib.request(u, opts, (res) => {
      let b = ''
      res.setEncoding('utf8')
      res.on('data', (d) => b += d)
      res.on('end', () => resolve({ status: res.statusCode, body: b }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

router.post('/signed-put-test', async (req, res) => {
  const { filename } = req.body || {}
  if (!filename) return res.status(400).json({ error: 'Missing filename' })
  if (!storageClient && (!admin || !admin.storage)) return res.status(500).json({ error: 'Storage not configured for signing' })
  try {
    const bucketName = (admin && admin.getBucketName && admin.getBucketName()) || process.env.FIREBASE_STORAGE_BUCKET
    const bucket = storageClient ? storageClient.bucket(bucketName) : (admin.getBucket ? admin.getBucket(bucketName) : (bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket()))
    const safeFilename = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_')
    const destPath = `uploads/test-${Date.now()}-${safeFilename}`
    const file = bucket.file(destPath)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
    const ct = req.body && (req.body.contentType || req.body.contenttype || null)
    // Sign without binding contentType by default
    const signOpts = { version: 'v4', action: 'write', expires: expiresAt }
    if (ct) signOpts.contentType = ct
    const [signedUrl] = await file.getSignedUrl(signOpts)
    try {
      const u = new URL(signedUrl)
      console.log('[debug signed-put-test] signedUrl params:', { 'X-Goog-SignedHeaders': u.searchParams.get('X-Goog-SignedHeaders'), 'X-Goog-Signature': u.searchParams.get('X-Goog-Signature') ? 'present' : 'missing' })
    } catch (_) {}
    const put = await putToSignedUrl(signedUrl, 'hello', ct)
    return res.json({ ok: true, signedUrlProvided: !!signedUrl, putStatus: put.status, putBody: put.body, path: destPath })
  } catch (err) {
    return res.status(500).json({ error: err && err.message ? err.message : String(err) })
  }
})

module.exports = router
