const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const http = require('http')
const admin = require('../../utils/firebaseAdmin')

const db = admin.db || (admin.firestore && admin.firestore())

async function streamDownload(url, dest) {
  // Follow up to 5 redirects
  return new Promise((resolve, reject) => {
    const maxRedirects = 5
    let redirects = 0

    function _get(u) {
      try {
        const lib = u.protocol === 'https:' ? https : http
        const req = lib.get(u, (res) => {
          // handle redirects
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < maxRedirects) {
            redirects++
            const next = new URL(res.headers.location, u)
            res.resume()
            return _get(next)
          }
          if (!res.statusCode || res.statusCode >= 400) return reject(new Error(`Failed to fetch ${url}: status ${res.statusCode}`))
          const fileStream = fs.createWriteStream(dest)
          res.pipe(fileStream)
          fileStream.on('finish', () => resolve())
          fileStream.on('error', reject)
        })
        req.on('error', reject)
      } catch (err) {
        reject(err)
      }
    }

    try {
      const u = new URL(url)
      _get(u)
    } catch (err) {
      reject(err)
    }
  })
}

async function downloadFromGs(gsUriOrPath, dest) {
  // gsUriOrPath may be 'gs://bucket/path' or a storage-relative path
  let bucketName = admin.getBucketName && admin.getBucketName()
  let filePath = gsUriOrPath
  if (gsUriOrPath && gsUriOrPath.startsWith && gsUriOrPath.startsWith('gs://')) {
    const without = gsUriOrPath.replace(/^gs:\/\//i, '')
    const idx = without.indexOf('/')
    if (idx > 0) {
      bucketName = without.slice(0, idx)
      filePath = without.slice(idx + 1)
    } else {
      throw new Error('Invalid gs:// URI')
    }
  }
  const bucket = admin.getBucket(bucketName)
  const remoteFile = bucket.file(filePath)
  const [exists] = await remoteFile.exists()
  if (!exists) throw new Error('Source file not found: ' + filePath)
  await remoteFile.download({ destination: dest })
}

async function uploadToBucket(localPath, destPath) {
  const bucket = admin.getBucket()
  await bucket.upload(localPath, { destination: destPath })
  const bucketName = admin.getBucketName()
  const publicUrl = `https://storage.googleapis.com/${bucketName}/${destPath}`
  return publicUrl
}

async function processJob(jobId, inputSpec) {
  console.log(`JOB START ${jobId}`)
  console.log(`[worker:${jobId}] processJob starting`, { inputSpec: !!inputSpec })
  try {
    if (!db) throw new Error('Firestore db not initialized')

    await db.collection('jobs').doc(jobId).set({ status: 'processing', progress: 0, message: 'Processing started', updatedAt: Date.now() }, { merge: true })

    // Normalize inputSpec
    let downloadURL = null
    let gsUri = null
    let storagePath = null
    if (typeof inputSpec === 'string') {
      gsUri = inputSpec
    } else if (inputSpec && typeof inputSpec === 'object') {
      // prefer downloadURL first, then storagePath/gsUri
      downloadURL = inputSpec.downloadURL || inputSpec.downloadUrl || null
      storagePath = inputSpec.storagePath || null
      gsUri = inputSpec.gsUri || null
    }

    // Prepare tmp
    const tmpDir = path.resolve(os.tmpdir(), 'autoed', 'uploads')
    fs.mkdirSync(tmpDir, { recursive: true })
    const base = (gsUri || storagePath || (downloadURL ? path.basename(new URL(downloadURL).pathname) : `download-${jobId}.bin`)).replace(/[^a-z0-9.\-_\.]/gi, '_')
    const localIn = path.resolve(tmpDir, `${jobId}-${base}`)

    // Fetch input
    console.log(`DOWNLOADING INPUT ${jobId}`)
    // Try downloadURL first (follow redirects). If that fails, fall back to storage.
    let downloaded = false
    if (downloadURL) {
      try {
        const containsAlt = downloadURL.includes('alt=media')
        const containsToken = downloadURL.includes('token=')
        const redacted = downloadURL.replace(/(token=)[^&]+/i, '$1<redacted>')
        console.log(`[worker:${jobId}] attempting HTTP download (redacted): ${redacted.slice(0,120)}`)
        console.log(`[worker:${jobId}] downloadURL contains alt=media=${containsAlt} token=${containsToken}`)
        await db.collection('jobs').doc(jobId).set({ progress: 5, message: 'Downloading from URL', updatedAt: Date.now() }, { merge: true })
        await streamDownload(downloadURL, localIn)
        await db.collection('jobs').doc(jobId).set({ progress: 20, message: 'Downloaded from URL', updatedAt: Date.now() }, { merge: true })
        downloaded = true
      } catch (e) {
        console.warn(`[worker:${jobId}] HTTP download failed, will attempt storage fallback:`, e && (e.message || e))
      }
    }

    if (!downloaded) {
      // Try gsUri then storagePath
      if (gsUri) {
        try {
          console.log(`[worker:${jobId}] using gsUri: ${gsUri}`)
          await db.collection('jobs').doc(jobId).set({ progress: 5, message: 'Downloading from gsUri', updatedAt: Date.now() }, { merge: true })
          await downloadFromGs(gsUri, localIn)
          await db.collection('jobs').doc(jobId).set({ progress: 20, message: 'Downloaded from gsUri', updatedAt: Date.now() }, { merge: true })
          downloaded = true
        } catch (e) {
          console.warn(`[worker:${jobId}] gsUri download failed, will try storagePath if present:`, e && (e.message || e))
        }
      }

      if (!downloaded && storagePath) {
        try {
          const bucketName = admin.getBucketName && admin.getBucketName()
          console.log(`[worker:${jobId}] using storagePath: ${storagePath} bucket=${bucketName}`)
          await db.collection('jobs').doc(jobId).set({ progress: 5, message: 'Downloading from storagePath', updatedAt: Date.now() }, { merge: true })
          const bucket = admin.getBucket(bucketName)
          const remoteFile = bucket.file(storagePath)
          // stream to local file
          await new Promise((resolve, reject) => {
            const rs = remoteFile.createReadStream()
            rs.on('error', (err) => reject(err))
            const ws = fs.createWriteStream(localIn)
            ws.on('error', reject)
            ws.on('finish', resolve)
            rs.pipe(ws)
          })
          await db.collection('jobs').doc(jobId).set({ progress: 20, message: 'Downloaded from storagePath', updatedAt: Date.now() }, { merge: true })
          downloaded = true
        } catch (e) {
          throw e
        }
      }
    }

    if (!downloaded) {
      throw new Error('No input source provided or download failed')
    }

    // Processing step
    console.log(`PROCESSING ${jobId}`)
    console.log(`[worker:${jobId}] running pipeline stub on ${localIn}`)
    const stat = fs.statSync(localIn)
    const result = {
      jobId,
      inputSize: stat.size,
      inputMtime: stat.mtimeMs,
      processedAt: Date.now(),
    }
    const outDir = path.resolve(os.tmpdir(), 'autoed', 'results')
    fs.mkdirSync(outDir, { recursive: true })
    const localResult = path.resolve(outDir, `${jobId}-result.json`)
    fs.writeFileSync(localResult, JSON.stringify(result, null, 2))

    // Upload result
    const destPath = `results/${jobId}/result.json`
    console.log(`JOB DONE ${jobId} uploading result to ${destPath}`)
    const resultUrl = await uploadToBucket(localResult, destPath)

    // Update job doc
    await db.collection('jobs').doc(jobId).set({ status: 'done', progress: 100, resultUrl, updatedAt: Date.now(), message: 'Completed' }, { merge: true })
    console.log(`[worker:${jobId}] completed, resultUrl=${resultUrl}`)
    console.log(`JOB DONE ${jobId}`)

    // cleanup
    try { fs.unlinkSync(localIn) } catch (e) {}
    try { fs.unlinkSync(localResult) } catch (e) {}

  } catch (err) {
    console.error(`JOB ERROR ${jobId}`, err && (err.stack || err.message || err))
    try {
      if (db) await db.collection('jobs').doc(jobId).set({ status: 'error', progress: 0, error: err && (err.message || String(err)), updatedAt: Date.now(), message: 'Processing error' }, { merge: true })
    } catch (e) {
      console.error(`[worker:${jobId}] failed to write error to Firestore`, e)
    }
    console.log(`JOB ERROR ${jobId}`)
  }
}

module.exports = { processJob }
