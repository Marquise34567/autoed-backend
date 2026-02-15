const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')

// Config via env
const PROXY_BASE = process.env.PROXY_BASE || process.env.NEXT_PUBLIC_VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_BASE || ''
const PROXY_PATH = process.env.PROXY_PATH || '/api/proxy/api/upload-url'
const BACKEND_BASE = process.env.BACKEND_BASE || process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || ''
const TEST_VIDEO_PATH = process.env.TEST_VIDEO_PATH || ''
const TEST_VIDEO_URL = process.env.TEST_VIDEO_URL || ''
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10)
const POLL_TIMEOUT_MS = parseInt(process.env.POLL_TIMEOUT_MS || String(1000 * 60 * 20), 10) // 20m

function now() { return new Date().toISOString() }

async function downloadToFile(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to download test video: ' + res.status)
  const destStream = fs.createWriteStream(dest)
  await new Promise((resolve, reject) => {
    res.body.pipe(destStream)
    res.body.on('error', reject)
    destStream.on('finish', resolve)
  })
}

async function main() {
  console.log('[e2e] start', now())

  if (!PROXY_BASE && !BACKEND_BASE) {
    console.error('[e2e] ERROR: set PROXY_BASE (Vercel URL) or BACKEND_BASE (Railway URL) in env')
    process.exit(2)
  }

  const proxyUrl = PROXY_BASE ? (PROXY_BASE.replace(/\/$/, '') + PROXY_PATH) : null
  const backendUploadUrl = BACKEND_BASE ? (BACKEND_BASE.replace(/\/$/, '') + '/api/upload-url') : null
  const backendJobsUrl = BACKEND_BASE ? (BACKEND_BASE.replace(/\/$/, '') + '/api/jobs') : null

  console.log('[e2e] using', { proxyUrl, backendUploadUrl, backendJobsUrl })

  // Ensure test video
  let videoPath = TEST_VIDEO_PATH
  if (!videoPath) {
    if (TEST_VIDEO_URL) {
      const tmp = path.resolve(process.cwd(), 'tmp', 'e2e_test_video.mp4')
      fs.mkdirSync(path.dirname(tmp), { recursive: true })
      console.log('[e2e] downloading test video from', TEST_VIDEO_URL)
      await downloadToFile(TEST_VIDEO_URL, tmp)
      videoPath = tmp
    }
  }
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error('[e2e] ERROR: No TEST_VIDEO_PATH or TEST_VIDEO_URL provided or file not found.')
    process.exit(3)
  }

  console.log('[e2e] test video:', videoPath, 'sizeBytes=', fs.statSync(videoPath).size)

  // Step 1: request signed URL (via proxy if available else backend directly)
  const requestTarget = proxyUrl || backendUploadUrl
  if (!requestTarget) {
    console.error('[e2e] ERROR: no request target configured')
    process.exit(4)
  }

  const filename = path.basename(videoPath)
  // infer content type by extension
  const ext = path.extname(filename).toLowerCase()
  let contentType = 'application/octet-stream'
  if (ext === '.mp4') contentType = 'video/mp4'
  else if (ext === '.mov') contentType = 'video/quicktime'
  else if (ext === '.mkv') contentType = 'video/x-matroska'
  else if (ext === '.webm') contentType = 'video/webm'
  else if (ext === '.avi') contentType = 'video/x-msvideo'
  console.log('[e2e] requesting signed url for', filename)
  const resp = await fetch(requestTarget, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, contentType }),
  })
  const text = await resp.text()
  let json = null
  try { json = JSON.parse(text) } catch (e) { console.error('[e2e] upload-url response not JSON:', text); throw e }
  if (!resp.ok) {
    console.error('[e2e] upload-url request failed', resp.status, text)
    process.exit(5)
  }
  console.log('[e2e] upload-url response', json)
  const uploadUrl = json.uploadUrl || json.signedUrl || json.url
  const storagePath = json.storagePath || json.path || json.storage_path
  if (!uploadUrl || !storagePath) {
    console.error('[e2e] upload-url missing uploadUrl or storagePath', json)
    process.exit(6)
  }

  // Step 2: PUT file to signed URL
  console.log('[e2e] uploading file to signed url')
  const fileStream = fs.createReadStream(videoPath)
  const putResp = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: fileStream })
  const putText = await putResp.text()
  if (!putResp.ok) {
    console.error('[e2e] upload PUT failed', putResp.status, putText)
    process.exit(7)
  }
  console.log('[e2e] upload PUT completed', putResp.status)

  // Step 3: create job
  if (!backendJobsUrl) {
    console.warn('[e2e] no BACKEND_BASE provided; skipping job creation and processing steps')
    process.exit(0)
  }
  console.log('[e2e] creating job for storagePath=', storagePath)
  const jobResp = await fetch(backendJobsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storagePath }) })
  const jobText = await jobResp.text()
  let jobJson = null
  try { jobJson = JSON.parse(jobText) } catch (e) { console.error('[e2e] jobs POST non-JSON:', jobText); throw e }
  if (!jobResp.ok) {
    console.error('[e2e] jobs POST failed', jobResp.status, jobText)
    process.exit(8)
  }

  const jobId = jobJson.id || jobJson.jobId || (jobJson && jobJson.id)
  if (!jobId) {
    console.error('[e2e] jobs POST response missing id', jobJson)
    process.exit(9)
  }
  console.log('[e2e] created job', jobId)

  // Step 4: poll job status until COMPLETE
  const start = Date.now()
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    console.log('[e2e] polling job status for', jobId)
    const q = await fetch(`${backendJobsUrl}?id=${jobId}`)
    const qText = await q.text()
    let qJson = null
    try { qJson = JSON.parse(qText) } catch (e) { console.log('[e2e] jobs GET non-json:', qText) }
    if (!q.ok) {
      console.error('[e2e] jobs GET failed', q.status, qText)
    } else {
      const job = qJson && qJson.job ? qJson.job : (qJson && qJson.jobs && qJson.jobs.length ? qJson.jobs[0] : null)
      console.log('[e2e] job state snapshot', job && { id: job.id, status: job.status, progress: job.progress, errorMessage: job.errorMessage })
      if (job && (String(job.status).toLowerCase() === 'complete' || String(job.status).toLowerCase() === 'completed')) {
        console.log('[e2e] PIPELINE COMPLETE. job=', jobId)
        console.log('[e2e] resultUrl=', job.resultUrl || job.videoUrl || job.finalVideoPath)
        process.exit(0)
      }
      if (job && (String(job.status).toLowerCase() === 'failed' || String(job.status).toLowerCase() === 'error')) {
        console.error('[e2e] JOB FAILED', job.errorMessage || job)
        process.exit(10)
      }
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }

  console.error('[e2e] TIMEOUT waiting for job to complete')
  process.exit(11)
}

main().catch((e) => { console.error('[e2e] uncaught error', e && (e.stack || e.message || e)); process.exit(99) })
