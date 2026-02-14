const express = require('express')
const mimeLib = require('mime-types')
const router = express.Router()

let admin = null
try { admin = require('../../utils/firebaseAdmin') } catch (e) { admin = null }

const http = require('http')
const https = require('https')
const { URL } = require('url')

function putToSignedUrl(signedUrl, body, ct) {
  const u = new URL(signedUrl)
  const lib = u.protocol === 'https:' ? https : http
  const opts = { method: 'PUT', headers: { 'Content-Type': ct, 'Content-Length': Buffer.byteLength(body) } }
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
  const { filename, contentType } = req.body || {}
  if (!filename || !contentType) return res.status(400).json({ error: 'Missing filename or contentType' })
  if (!admin || !admin.storage) return res.status(500).json({ error: 'Firebase admin not configured' })
  try {
    const bucketName = (admin.getBucketName && admin.getBucketName()) || undefined
    const bucket = admin.getBucket ? admin.getBucket(bucketName) : (bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket())
    const safeFilename = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_')
    const destPath = `uploads/test-${Date.now()}-${safeFilename}`
    const file = bucket.file(destPath)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
    const [signedUrl] = await file.getSignedUrl({ version: 'v4', action: 'write', expires: expiresAt, contentType: contentType })
    const put = await putToSignedUrl(signedUrl, 'hello', contentType)
    return res.json({ ok: true, signedUrlProvided: !!signedUrl, putStatus: put.status, putBody: put.body, path: destPath })
  } catch (err) {
    return res.status(500).json({ error: err && err.message ? err.message : String(err) })
  }
})

module.exports = router
