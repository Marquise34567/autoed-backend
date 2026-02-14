const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const http = require('http')
const { exec } = require('child_process')
const admin = require('../../utils/firebaseAdmin')
const { getSignedUrlForPath } = require('../../utils/storageSignedUrl')

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
  // stream to destination to avoid loading entire file in memory
  await new Promise((resolve, reject) => {
    const rs = remoteFile.createReadStream()
    rs.on('error', reject)
    const ws = fs.createWriteStream(dest)
    ws.on('error', reject)
    ws.on('finish', resolve)
    rs.pipe(ws)
  })
}

async function uploadToBucket(localPath, destPath) {
  const bucket = admin.getBucket()
  await bucket.upload(localPath, { destination: destPath })
  // return a time-limited signed URL instead of a public storage URL
  const signed = await getSignedUrlForPath(destPath, 30)
  return signed
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
    // Prefer storagePath/gsUri (stream from Firebase Admin) then fall back to downloadURL
    let downloaded = false

    // 1) storagePath (preferred)
    if (storagePath) {
      try {
        const bucketName = admin.getBucketName && admin.getBucketName()
        console.log(`[worker] ${jobId} downloading using storagePath=${storagePath} bucket=${bucketName}`)
        await db.collection('jobs').doc(jobId).set({ progress: 5, message: 'Downloading from storagePath', updatedAt: Date.now() }, { merge: true })
        const bucket = admin.getBucket(bucketName)
        const remoteFile = bucket.file(storagePath)
        const [exists] = await remoteFile.exists()
        if (!exists) throw new Error(`Source file not found: ${storagePath}`)
        await new Promise((resolve, reject) => {
          const rs = remoteFile.createReadStream()
          rs.on('error', (err) => reject(err))
          const ws = fs.createWriteStream(localIn)
          ws.on('error', reject)
          ws.on('finish', resolve)
          rs.pipe(ws)
        })
        console.log(`[worker] ${jobId} download complete ${localIn}`)
        await db.collection('jobs').doc(jobId).set({ progress: 20, message: 'Downloaded from storagePath', updatedAt: Date.now() }, { merge: true })
        downloaded = true
      } catch (e) {
        console.warn(`[worker] ${jobId} storagePath download failed, will try gsUri/downloadURL:`, e && (e.message || e))
      }
    }

    // 2) gsUri (if not yet downloaded)
    if (!downloaded && gsUri) {
      try {
        console.log(`[worker] ${jobId} downloading using gsUri=${gsUri}`)
        await db.collection('jobs').doc(jobId).set({ progress: 5, message: 'Downloading from gsUri', updatedAt: Date.now() }, { merge: true })
        await downloadFromGs(gsUri, localIn)
        console.log(`[worker] ${jobId} download complete ${localIn}`)
        await db.collection('jobs').doc(jobId).set({ progress: 20, message: 'Downloaded from gsUri', updatedAt: Date.now() }, { merge: true })
        downloaded = true
      } catch (e) {
        console.warn(`[worker] ${jobId} gsUri download failed, will try downloadURL:`, e && (e.message || e))
      }
    }

    // 3) downloadURL fallback
    if (!downloaded && downloadURL) {
      try {
        const containsAlt = downloadURL.includes('alt=media')
        const containsToken = downloadURL.includes('token=')
        const redacted = downloadURL.replace(/(token=)[^&]+/i, '$1<redacted>')
        console.log(`[worker] ${jobId} downloading using downloadURL (redacted): ${redacted.slice(0,120)}`)
        console.log(`[worker] ${jobId} downloadURL alt=media=${containsAlt} token=${containsToken}`)
        await db.collection('jobs').doc(jobId).set({ progress: 5, message: 'Downloading from URL', updatedAt: Date.now() }, { merge: true })
        await streamDownload(downloadURL, localIn)
        console.log(`[worker] ${jobId} download complete ${localIn}`)
        await db.collection('jobs').doc(jobId).set({ progress: 20, message: 'Downloaded from URL', updatedAt: Date.now() }, { merge: true })
        downloaded = true
      } catch (e) {
        console.warn(`[worker] ${jobId} HTTP download failed:`, e && (e.message || e))
      }
    }

    if (!downloaded) {
      throw new Error('No input source provided or download failed')
    }

    // Processing step: run FFmpeg to produce an MP4 output from the input
    console.log(`PROCESSING ${jobId}`)
    console.log(`[worker:${jobId}] running pipeline on ${localIn}`)
    const stat = fs.statSync(localIn)
    const outDir = path.resolve(os.tmpdir(), 'autoed', 'results')
    fs.mkdirSync(outDir, { recursive: true })

    // Prepare local result JSON
    const result = {
      jobId,
      inputSize: stat.size,
      inputMtime: stat.mtimeMs,
      processedAt: Date.now(),
    }
    const localResult = path.resolve(outDir, `${jobId}-result.json`)
    fs.writeFileSync(localResult, JSON.stringify(result, null, 2))

    // Produce output video (MP4)
    const localOut = path.resolve(outDir, `${jobId}-output.mp4`)
    const ffmpegCmd = `ffmpeg -y -i "${localIn}" -c:v libx264 -preset veryfast -crf 23 -c:a aac -movflags +faststart "${localOut}"`
    try {
      console.log(`[worker:${jobId}] Running FFmpeg: ${ffmpegCmd}`)
      await new Promise((resolve, reject) => {
        const proc = exec(ffmpegCmd, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
          if (error) return reject(error)
          return resolve({ stdout, stderr })
        })
        if (proc.stdout && proc.stdout.on) proc.stdout.on('data', (d) => console.log(`[worker:${jobId}] ffmpeg: ${String(d).trim()}`))
        if (proc.stderr && proc.stderr.on) proc.stderr.on('data', (d) => console.log(`[worker:${jobId}] ffmpeg: ${String(d).trim()}`))
      })
      console.log(`[worker:${jobId}] FFmpeg finished, output at ${localOut}`)
    } catch (e) {
      console.warn(`[worker:${jobId}] FFmpeg failed, will still upload result.json:`, e && (e.message || e))
    }

    // Upload result.json first (small, quick)
    const destResultPath = `results/${jobId}/result.json`
    console.log(`JOB ${jobId} uploading result JSON to ${destResultPath}`)
    let resultUrl = null
    try {
      resultUrl = await uploadToBucket(localResult, destResultPath)
    } catch (e) {
      console.warn(`[worker:${jobId}] failed to upload result.json`, e && (e.message || e))
    }

    // If a local output file exists, upload it to results/<jobId>/output.mp4
    const destVideoPath = `results/${jobId}/output.mp4`
    let outputUrl = null
    try {
      if (fs.existsSync(localOut)) {
        const bucket = admin.getBucket()
        console.log(`[worker:${jobId}] uploading output video to ${destVideoPath}`)
        await bucket.upload(localOut, { destination: destVideoPath, metadata: { contentType: 'video/mp4' } })
        try {
          // generate signed URL for the uploaded video (do not log)
          outputUrl = await getSignedUrlForPath(destVideoPath, 60)
        } catch (err) {
          console.warn('[worker] failed to generate signed URL for video', err && (err.message || err))
        }
      } else {
        console.warn(`[worker:${jobId}] no local output file found at ${localOut}; skipping video upload`)
      }
    } catch (e) {
      console.error(`[worker:${jobId}] failed to upload output video`, e && (e.stack || e.message || e))
    }

    // Update job doc: include output path and optionally signed URL for download
    const jobUpdate = { status: 'done', progress: 100, updatedAt: Date.now(), message: 'Completed' }
    if (resultUrl) jobUpdate.resultUrl = resultUrl
    if (outputUrl) jobUpdate.outputUrl = outputUrl
    jobUpdate.outputPath = destVideoPath
    await db.collection('jobs').doc(jobId).set(jobUpdate, { merge: true })
    console.log(`[worker:${jobId}] completed, resultPath=${destResultPath} outputPath=${destVideoPath}`)

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
