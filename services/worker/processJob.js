const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const http = require('http')
const { exec } = require('child_process')
const admin = require('../firebaseAdmin')
let db = null
let bucket = null
try { db = (admin && (admin.db || (typeof admin.firestore === 'function' ? admin.firestore() : null))) || null } catch (e) { db = admin && admin.db }
try { bucket = admin && admin.bucket ? admin.bucket : null } catch (e) { bucket = null }
const { getSignedUrlForPath } = require('../../utils/storageSignedUrl')

const DEFAULT_BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET ? String(process.env.FIREBASE_STORAGE_BUCKET).replace(/^gs:\/\//i, '').trim() : null

function getBucketObject(name) {
  if (name) return admin.storage().bucket(name)
  if (bucket) return bucket
  if (DEFAULT_BUCKET_NAME) return admin.storage().bucket(DEFAULT_BUCKET_NAME)
  return admin.storage().bucket()
}

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
  let bucketName = DEFAULT_BUCKET_NAME
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
  const bucketObj = getBucketObject(bucketName)
  const remoteFile = bucketObj.file(filePath)
  const [exists] = await remoteFile.exists()
  if (!exists) {
    if (bucketName && bucketName.endsWith && bucketName.endsWith('.firebasestorage.app')) {
      const alt = bucketName.replace('.firebasestorage.app', '.appspot.com')
      try {
        const altBucket = getBucketObject(alt)
        const altFile = altBucket.file(filePath)
        const [altExists] = await altFile.exists()
        if (altExists) return await new Promise((resolve, reject) => {
          const rs = altFile.createReadStream()
          rs.on('error', reject)
          const ws = fs.createWriteStream(dest)
          ws.on('error', reject)
          ws.on('finish', resolve)
          rs.pipe(ws)
        })
      } catch (e) {}
    }
    // Try default bucket as a last resort
    try {
      const defaultBucket = admin.storage().bucket()
      const defFile = defaultBucket.file(filePath)
      const [defExists] = await defFile.exists()
      if (defExists) return await new Promise((resolve, reject) => {
        const rs = defFile.createReadStream()
        rs.on('error', reject)
        const ws = fs.createWriteStream(dest)
        ws.on('error', reject)
        ws.on('finish', resolve)
        rs.pipe(ws)
      })
    } catch (e) {}
    throw new Error('Source file not found: ' + filePath)
  }
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
  const bucketObj = getBucketObject()
  await bucketObj.upload(localPath, { destination: destPath })
  // return a time-limited signed URL instead of a public storage URL
  const signed = await getSignedUrlForPath(destPath, 30)
  return signed
}

async function processJob(jobId, inputSpec) {
  // structured JSON logger
  function jlog(event, meta = {}) {
    const base = { ts: new Date().toISOString(), event, jobId, workerId: process.env.RAILWAY_SERVICE_NAME || require('os').hostname() }
    try { console.log(JSON.stringify(Object.assign(base, meta))) } catch (e) { console.log(base, meta) }
  }

  // legacy shim used in many places in this file
  function log(event, ...args) { jlog(event, { args }) }

  jlog('process_start', { hasInputSpec: !!inputSpec })
  console.log('[worker] Processing job:', jobId)
  try {
    if (!db) throw new Error('Firestore db not initialized')

    function sanitizeStatus(s) {
      const allowed = ['queued', 'processing', 'completed', 'failed']
      const v = (s || '').toString().toLowerCase()
      return allowed.includes(v) ? v : null
    }

    function clampProgress(v) {
      let p = Number(v) || 0
      if (Number.isFinite(p)) {
        if (p > 0 && p <= 1) p = Math.round(p * 100)
        if (p < 0) p = 0
        if (p > 100) p = 100
        return Math.round(p)
      }
      return 0
    }

    async function updateJobPatch(patch) {
      const p = { ...patch }
      if (typeof p.progress !== 'undefined') p.progress = clampProgress(p.progress)
      try { await db.collection('jobs').doc(jobId).set(p, { merge: true }) } catch (e) { log('updateJobPatch failed', e && (e.message || e)) }
    }

    await updateJobPatch({ status: sanitizeStatus('processing'), phase: 'PROCESSING', progress: clampProgress(5), message: 'Processing started', startedAt: admin.firestore.FieldValue.serverTimestamp(), lockedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() })

    // Resolve input path from job document with fallbacks (prefer `inputPath`)
    let storagePath = null
    let bucketName = process.env.FIREBASE_STORAGE_BUCKET || DEFAULT_BUCKET_NAME || null
    let jobDoc = null
    try {
      const jobSnap = await db.collection('jobs').doc(jobId).get()
      jobDoc = jobSnap && jobSnap.exists ? jobSnap.data() : null
      storagePath = jobDoc && (jobDoc.inputPath || jobDoc.bucketPath || (jobDoc.input && jobDoc.input.storagePath) || jobDoc.storagePath) ? (jobDoc.inputPath || jobDoc.bucketPath || (jobDoc.input && jobDoc.input.storagePath) || jobDoc.storagePath) : null
      jlog('job_doc_input_resolution', { inputPath: jobDoc && jobDoc.inputPath || null, bucketPath: jobDoc && jobDoc.bucketPath || null, input_storagePath: jobDoc && jobDoc.input && jobDoc.input.storagePath || null })
    } catch (e) {
      throw new Error('Failed to read job document: ' + (e && e.message))
    }

    if (!storagePath) {
      throw new Error('No input path on job')
    }

    // build canonical gsUri for logging/consumption and derive downloadURL
    const downloadURL = (jobDoc && jobDoc.input && jobDoc.input.downloadURL) || (jobDoc && jobDoc.downloadURL) || (inputSpec && inputSpec.downloadURL) || null
    const inputGsUri = (jobDoc && jobDoc.input && jobDoc.input.gsUri) || (bucketName && storagePath ? `gs://${bucketName}/${storagePath}` : null)

    // Persist outputPath early so callers never see a null outputPath when signing
    const uid = (jobDoc && (jobDoc.userId || jobDoc.uid)) || 'unknown'
    const outputPath = `outputs/${uid}/${jobId}.mp4`
    try {
      await updateJobPatch({ outputPath })
      jlog('persisted_outputPath', { outputPath })
    } catch (e) {
      console.warn('[worker] failed to persist outputPath early', e && (e.message || e))
    }

    // Log normalized input source
    jlog('normalized_input', { bucketName, storagePath, inputGsUri })
    try { console.log('[worker] Worker reading input from:', bucketName, storagePath, inputGsUri) } catch (e) {}

    // Prepare tmp
    const tmpDir = path.resolve(os.tmpdir(), 'autoed', 'uploads')
    fs.mkdirSync(tmpDir, { recursive: true })
    const base = (inputGsUri || storagePath || (downloadURL ? path.basename(new URL(downloadURL).pathname) : `download-${jobId}.bin`)).replace(/[^a-z0-9.\-_\.]/gi, '_')
    const localIn = path.resolve(tmpDir, `${jobId}-${base}`)

    // Fetch input
    jlog('download_start')
    // Prefer storagePath/gsUri (stream from Firebase Admin) then fall back to downloadURL
    let downloaded = false

    // 1) storagePath (preferred)
    if (storagePath) {
      try {
        console.log(`[worker] ${jobId} downloading using storagePath=${storagePath} bucket=${bucketName}`)
        await updateJobPatch({ progress: 2, phase: 'DOWNLOADING', message: 'Downloading from storagePath', updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        const bucketObj = getBucketObject(bucketName)
        const remoteFile = bucketObj.file(storagePath)
        const [exists] = await remoteFile.exists()
        if (!exists) throw new Error(`Source file not found in bucket: ${bucketName}/${storagePath}`)
        await new Promise((resolve, reject) => {
          const rs = remoteFile.createReadStream()
          rs.on('error', (err) => reject(err))
          const ws = fs.createWriteStream(localIn)
          ws.on('error', reject)
          ws.on('finish', resolve)
          rs.pipe(ws)
        })
        jlog('download_complete', { localIn })
        await updateJobPatch({ progress: 20, phase: 'DOWNLOADING', message: 'Downloaded from storagePath', updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        downloaded = true
      } catch (e) {
        console.warn(`[worker] ${jobId} storagePath download failed, will try gsUri/downloadURL:`, e && (e.message || e))
        await updateJobPatch({ errorDebug: `storagePath download failed: ${e && (e.message || e)}` })
      }
    }

    // 2) gsUri (if not yet downloaded)
    if (!downloaded && inputGsUri) {
      try {
        console.log(`[worker] ${jobId} downloading using gsUri=${inputGsUri}`)
        await updateJobPatch({ progress: 5, message: 'Downloading from gsUri', updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        await downloadFromGs(inputGsUri, localIn)
        jlog('download_complete', { localIn })
        await updateJobPatch({ progress: 20, message: 'Downloaded from gsUri', updatedAt: admin.firestore.FieldValue.serverTimestamp() })
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
        await updateJobPatch({ progress: 5, message: 'Downloading from URL', updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        await streamDownload(downloadURL, localIn)
        jlog('download_complete', { localIn })
        await updateJobPatch({ progress: 20, message: 'Downloaded from URL', updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        downloaded = true
      } catch (e) {
        console.warn(`[worker] ${jobId} HTTP download failed:`, e && (e.message || e))
      }
    }

    if (!downloaded) {
      // Provide clear diagnostics on why download failed
      const present = { storagePath: !!storagePath, gsUri: !!gsUri, downloadURL: !!downloadURL, bucketName: !!bucketName }
      throw new Error('No input source provided or download failed. Present fields: ' + JSON.stringify(present))
    }

      jlog('stage_download_start')

    // Processing step: run retention-edit pipeline (transcribe -> AI plan -> trim+concat)
    jlog('processing_start')
    jlog('pipeline_start', { localIn })
    const stat = fs.statSync(localIn)
    const outDir = path.resolve(os.tmpdir(), 'autoed', 'results')
    fs.mkdirSync(outDir, { recursive: true })

    // Prepare local result JSON (kept for backward compatibility)
    const result = {
      jobId,
      inputSize: stat.size,
      inputMtime: stat.mtimeMs,
      processedAt: Date.now(),
    }
    const localResult = path.resolve(outDir, `${jobId}-result.json`)
    fs.writeFileSync(localResult, JSON.stringify(result, null, 2))

    // Helper: update job stage
    async function setStage(stage, percent, message) {
      try {
        await updateJobPatch({ stage, progress: percent, message, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
      } catch (e) { log('failed setStage', e && (e.stack || e.message || e)) }
    }

    // Helper: run shell commands with spawn, capture output, enforce timeout
    // Also collect child processes so an overall timer can kill them.
    const childProcs = []
    function runShellCommand(cmd, opts = {}) {
      const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : (15 * 60 * 1000) // default 15 minutes
      return new Promise((resolve, reject) => {
        jlog('ffmpeg_cmd_start', { cmd: cmd.slice ? cmd.slice(0,200) : String(cmd) })
        const proc = spawn(cmd, { shell: true })
        childProcs.push(proc)
        let stdout = ''
        let stderr = ''
        if (proc.stdout) proc.stdout.on('data', (d) => { stdout += String(d); if (stdout.length > 20000) stdout = stdout.slice(-20000); jlog('ffmpeg_stdout', { chunk: String(d).slice(0,200) }) })
        if (proc.stderr) proc.stderr.on('data', (d) => { stderr += String(d); if (stderr.length > 20000) stderr = stderr.slice(-20000); jlog('ffmpeg_stderr', { chunk: String(d).slice(0,200) }) })
        const to = setTimeout(() => {
          try { proc.kill('SIGKILL') } catch (e) {}
          const err = new Error('process timeout')
          err.code = 'ETIMEDOUT'
          err.stdout = stdout
          err.stderr = stderr
          jlog('ffmpeg_cmd_timeout', { code: err.code })
          reject(err)
        }, timeoutMs)
        proc.on('error', (err) => {
          clearTimeout(to)
          err.stdout = stdout
          err.stderr = stderr
          jlog('ffmpeg_cmd_error', { message: err.message })
          reject(err)
        })
        proc.on('close', (code, signal) => {
          clearTimeout(to)
          jlog('ffmpeg_cmd_done', { code, signal })
          resolve({ code, signal, stdout, stderr })
        })
      })
    }

    // overall processing timeout (kill any child processes)
    const OVERALL_TIMEOUT_MS = Number(process.env.JOB_PROCESSING_TIMEOUT_MS || 20 * 60 * 1000)
    let overallTimer = null
    if (OVERALL_TIMEOUT_MS > 0) {
      overallTimer = setTimeout(() => {
        jlog('processing_overall_timeout', { timeoutMs: OVERALL_TIMEOUT_MS })
        for (const p of childProcs) try { p.kill('SIGKILL') } catch (e) {}
      }, OVERALL_TIMEOUT_MS)
    }

    // 1) Extract audio for transcription
    await setStage('Adding Hooks', 25, 'Extracting audio for transcription')
    const audioPath = path.resolve(outDir, `${jobId}-audio.wav`)
    const extractCmd = `ffmpeg -y -i "${localIn}" -vn -ac 1 -ar 16000 -hide_banner -loglevel error "${audioPath}"`
    log('FFMPEG extract cmd', extractCmd.slice(0,200))
    try {
      const r = await runShellCommand(extractCmd, { timeoutMs: 2 * 60 * 1000 })
      log('FFMPEG DONE extract', { code: r.code })
    } catch (e) {
      log('audio extract failed', e && (e.message || e), e && e.stderr ? e.stderr.slice(-2000) : '')
    }

    // 2) Transcribe using OpenAI Whisper (if OPENAI_API_KEY present)
    let transcriptText = null
    let transcriptSegments = null
    const OPENAI_KEY = process.env.OPENAI_API_KEY
    if (OPENAI_KEY && fs.existsSync(audioPath)) {
      try {
        await setStage('Adding Hooks', 30, 'Transcribing audio')
        const form = new (global.FormData || require('form-data'))()
        form.append('file', fs.createReadStream(audioPath))
        form.append('model', 'whisper-1')
        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${OPENAI_KEY}` },
          body: form
        })
        if (!res.ok) throw new Error(`transcription failed: ${res.status}`)
        const tjson = await res.json()
        transcriptText = tjson.text || null
        // whisper may not return segments via this endpoint; if it does, capture
        transcriptSegments = tjson.segments || null
        console.log('[worker] transcription length:', transcriptText && transcriptText.length)
      } catch (e) {
        console.warn('[worker] transcription error', e && (e.stack || e.message || e))
      }
    } else {
      console.warn('[worker] OPENAI_API_KEY missing or audio not present; skipping transcription')
    }

    // 3) Ask OpenAI to produce an edit plan JSON
    await setStage('Adding Hooks', 40, 'Generating AI edit plan')
    let aiPlan = null
    const durationSec = await (async () => {
      try {
        const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${localIn}"`
        const rr = await runShellCommand(cmd, { timeoutMs: 30 * 1000 })
        const v = parseFloat((rr.stdout || '').trim())
        return Number.isFinite(v) ? v : null
      } catch (e) { return null }
    })()

    async function callOpenAIEditPlan(transcript, duration) {
      const model = process.env.OPENAI_MODEL || 'gpt-4'
      const system = `You are an elite YouTube retention strategist and AI video editor. Produce a STRICT JSON edit plan (no surrounding text) following the schema exactly. Hook must be 3-5s. Remove boring segments 5-10s where possible. Ensure segments are within duration and non-overlapping.`
      const user = `TRANSCRIPT:\n${transcript || ''}\n\nDURATION:${duration || 'unknown'}\n\nReturn only JSON with keys: hook, keepSegments, removeSegments, notes.`
      const payload = { model, messages: [ { role: 'system', content: system }, { role: 'user', content: user } ], max_tokens: 1500, temperature: 0.2 }
      const resp = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` }, body: JSON.stringify(payload) })
      if (!resp.ok) throw new Error('OpenAI edit plan request failed: ' + resp.status)
      const j = await resp.json()
      const txt = j.choices && j.choices[0] && (j.choices[0].message && j.choices[0].message.content) || j.choices && j.choices[0] && j.choices[0].text
      if (!txt) throw new Error('No content from OpenAI')
      // Try to extract JSON substring
      const m = txt.match(/\{[\s\S]*\}$/m)
      const jsonStr = m ? m[0] : txt
      let parsed = null
      try { parsed = JSON.parse(jsonStr) } catch (e) { throw new Error('Failed to parse JSON from OpenAI: ' + e.message) }
      return parsed
    }

    if (OPENAI_KEY && transcriptText) {
      try {
        aiPlan = await callOpenAIEditPlan(transcriptText, durationSec)
        jlog('ai_plan', { plan: aiPlan })
      } catch (e) {
        console.warn('[worker] OpenAI plan failed', e && (e.stack || e.message || e))
        aiPlan = null
      }
    }

    // Validate AI plan (manual schema enforcement)
    function validatePlan(p, dur) {
      if (!p || typeof p !== 'object') return false
      if (!p.hook || typeof p.hook.start !== 'number' || typeof p.hook.end !== 'number') return false
      const okRange = (s, e) => typeof s === 'number' && typeof e === 'number' && s >= 0 && e > s && (!dur || e <= dur)
      if (!okRange(p.hook.start, p.hook.end)) return false
      const segs = Array.isArray(p.keepSegments) ? p.keepSegments : []
      for (const s of segs) if (!okRange(s.start, s.end)) return false
      const rems = Array.isArray(p.removeSegments) ? p.removeSegments : []
      for (const r of rems) if (!okRange(r.start, r.end)) return false
      // hook length 3-5s
      const hookLen = p.hook.end - p.hook.start
      if (hookLen < 3 || hookLen > 5) return false
      return true
    }

    let duration = durationSec || stat && stat.duration || null

    if (!validatePlan(aiPlan, duration)) {
      console.warn('[worker] AI plan invalid or missing; falling back to silence-tighten fallback')
      // Fallback: detect silences and remove segments >0.6s
      await setStage('Cutting', 55, 'Detecting silences for fallback trimming')
      const silCmd = `ffmpeg -i "${localIn}" -af silencedetect=noise=-30dB:d=0.6 -f null -`
      let silOutput = ''
      try {
        const rr = await runShellCommand(silCmd, { timeoutMs: 60 * 1000 })
        silOutput += rr.stderr || ''
      } catch (e) { console.warn('[worker] silence detect failed', e && e.message || e); if (e && e.stderr) silOutput += e.stderr }
      const silenceStarts = []
      const silenceEnds = []
      for (const line of silOutput.split(/\r?\n/)) {
        const m1 = line.match(/silence_start:\s*([0-9.]+)/)
        const m2 = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/)
        if (m1) silenceStarts.push(parseFloat(m1[1]))
        if (m2) silenceEnds.push({ end: parseFloat(m2[1]), dur: parseFloat(m2[2]) })
      }
      const removeSegments = []
      // pair starts and ends
      for (let i = 0; i < Math.min(silenceStarts.length, silenceEnds.length); i++) {
        const s = silenceStarts[i]
        const e = silenceEnds[i].end
        const durSil = silenceEnds[i].dur
        if (durSil >= 0.6 && durSil <= 30) {
          // clip to 5-10s preference if possible
          removeSegments.push({ start: s, end: e, reason: 'silence' })
        }
      }
      // Build keepSegments as complement
      const keepSegments = []
      let cursor = 0
      for (const r of removeSegments) {
        if (r.start - cursor > 0.05) keepSegments.push({ start: cursor, end: r.start, reason: 'keep' })
        cursor = r.end
      }
      // final tail
      if (!Number.isFinite(duration)) {
        // try probe for duration
        try {
          const rr = await runShellCommand(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${localIn}"`, { timeoutMs: 30 * 1000 })
          const d = parseFloat((rr.stdout || '').trim())
          if (Number.isFinite(d)) duration = d
        } catch (e) {}
      }
      if (Number.isFinite(duration)) {
        if (duration - cursor > 0.05) keepSegments.push({ start: cursor, end: duration, reason: 'tail' })
      } else {
        // nothing reliable; keep whole
        keepSegments.push({ start: 0, end: stat.size ? stat.size : 0, reason: 'fallback_whole' })
      }
      aiPlan = { hook: { start: 0, end: Math.min(4, keepSegments[0] ? (keepSegments[0].end - keepSegments[0].start) : 4), reason: 'fallback hook' }, keepSegments, removeSegments, notes: { pacing: 'fallback silence-tighten', warnings: [] } }
      jlog('ai_plan_fallback', { plan: aiPlan })
    }

    // Build finalSegments: hook first, then keepSegments but remove overlaps with removeSegments
    await setStage('Cutting', 65, 'Building final segments')
    const finalSegments = []
    // push hook
    if (aiPlan.hook) finalSegments.push({ start: aiPlan.hook.start, end: aiPlan.hook.end, reason: aiPlan.hook.reason || 'hook' })
    // append keepSegments
    const ks = Array.isArray(aiPlan.keepSegments) ? aiPlan.keepSegments.slice() : []
    // ensure ascending and non-overlapping
    ks.sort((a,b) => a.start - b.start)
    for (const s of ks) {
      // skip if fully contained in hook
      if (s.end <= (aiPlan.hook && aiPlan.hook.end)) continue
      // adjust start if overlaps hook
      const start = Math.max(s.start, aiPlan.hook ? aiPlan.hook.end : 0)
      if (start < s.end) finalSegments.push({ start, end: s.end, reason: s.reason || 'keep' })
    }
    // Merge tiny gaps <0.25s
    const merged = []
    for (const seg of finalSegments) {
      if (!merged.length) merged.push(seg)
      else {
        const last = merged[merged.length-1]
        if (seg.start - last.end <= 0.25) {
          last.end = Math.max(last.end, seg.end)
        } else merged.push(seg)
      }
    }
    jlog('final_segments', { segments: merged })

    if (!merged.length) throw new Error('No segments to render after AI plan/fallback')

      console.log(`[worker:${jobId}] stage=transcode`)

    // 3b) Ask OpenAI for zoom keyframes (strict JSON schema)
    await setStage('Adding Hooks', 50, 'Requesting zoom keyframes from AI')
    let aiZooms = null
    async function callOpenAIZooms(transcript, duration) {
      const model = process.env.OPENAI_MODEL || 'gpt-4'
      const system = `You are an expert video editor producing a STRICT JSON array of zoom keyframes following the exact schema. Return ONLY JSON.`
      const user = `SCHEMA:\n{ "zooms": [ { "start": 12.0, "end": 15.5, "type": "in|out", "scale": 1.06, "easing": "linear|easeInOut", "reason": "text" } ] }\n\nRULES:\n- zoom events every ~6-12s when possible; scale ranges: in 1.03-1.12, out 1.00-1.06; duration 0.8-3.0s; within video duration; min 1.5s between events.\n\nTRANSCRIPT:\n${transcript || ''}\n\nDURATION:${duration || 'unknown'}\n\nReturn only the JSON object (no explanation).`
      const payload = { model, messages: [ { role: 'system', content: system }, { role: 'user', content: user } ], max_tokens: 800, temperature: 0.2 }
      const resp = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` }, body: JSON.stringify(payload) })
      if (!resp.ok) throw new Error('OpenAI zoom request failed: ' + resp.status)
      const j = await resp.json()
      const txt = j.choices && j.choices[0] && (j.choices[0].message && j.choices[0].message.content) || j.choices && j.choices[0] && j.choices[0].text
      if (!txt) throw new Error('No content from OpenAI (zooms)')
      const m = txt.match(/\{[\s\S]*\}$/m)
      const jsonStr = m ? m[0] : txt
      let parsed = null
      try { parsed = JSON.parse(jsonStr) } catch (e) { throw new Error('Failed to parse zoom JSON from OpenAI: ' + e.message) }
      return parsed
    }

    function validateZooms(obj, dur) {
      if (!obj || typeof obj !== 'object') return false
      if (!Array.isArray(obj.zooms)) return false
      const zooms = obj.zooms
      for (const z of zooms) {
        if (typeof z.start !== 'number' || typeof z.end !== 'number') return false
        if (!(z.type === 'in' || z.type === 'out')) return false
        if (typeof z.scale !== 'number') return false
        if (!(z.easing === 'linear' || z.easing === 'easeInOut')) return false
        if (z.start < 0 || z.end <= z.start) return false
        if (dur && z.end > dur) return false
        const durZoom = z.end - z.start
        if (durZoom < 0.8 || durZoom > 3.0) return false
        if (z.type === 'in' && (z.scale < 1.03 || z.scale > 1.12)) return false
        if (z.type === 'out' && (z.scale < 1.0 || z.scale > 1.06)) return false
      }
      // enforce min gap 1.5s
      const sorted = zooms.slice().sort((a,b) => a.start - b.start)
      for (let i=1;i<sorted.length;i++) if (sorted[i].start - sorted[i-1].end < 1.5) return false
      return true
    }

    try {
      if (OPENAI_KEY && transcriptText) {
        const zresp = await callOpenAIZooms(transcriptText, duration)
        if (validateZooms(zresp, duration)) aiZooms = zresp.zooms
        else {
          console.warn('[worker] AI zooms invalid per schema')
          aiZooms = []
        }
      } else {
        aiZooms = []
      }
    } catch (e) {
      console.warn('[worker] failed to get AI zooms', e && (e.message || e))
      aiZooms = []
    }

    // Remap original zoom timestamps -> final timeline (merged segments)
    function remapZoomsToFinal(zooms, segments) {
      const remapped = []
      let cursor = 0
      for (const seg of segments) {
        const segLen = seg.end - seg.start
        for (const z of zooms) {
          const interStart = Math.max(seg.start, z.start)
          const interEnd = Math.min(seg.end, z.end)
          if (interEnd > interStart) {
            const localStart = interStart - seg.start
            const localEnd = interEnd - seg.start
            remapped.push({ start: cursor + localStart, end: cursor + localEnd, type: z.type, scale: z.scale, easing: z.easing, reason: z.reason })
          }
        }
        cursor += segLen
      }
      return remapped
    }

    // Remap using only the safePlan zooms (guardrails-enforced)
    const remappedZooms = remapZoomsToFinal(safePlan.zooms || [], merged)
    jlog('ai_zooms_original', { zooms: safePlan.zooms || [] })
    jlog('ai_zooms_remapped', { zooms: remappedZooms })

    // 4) Render with ffmpeg trim+concat + zooms
    await setStage('Pacing', 80, 'Rendering final video with zooms')
    const localOut = path.resolve(outDir, `${jobId}-output.mp4`)

    // probe input for resolution/fps
    let WIDTH = 1280, HEIGHT = 720, FPS = 30
    try {
      const rr = await runShellCommand(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of default=noprint_wrappers=1:nokey=1 "${localIn}"`, { timeoutMs: 30 * 1000 })
      const probeOut = rr.stdout || ''
      const lines = probeOut.trim().split(/\r?\n/)
      if (lines[0]) WIDTH = parseInt(lines[0]) || WIDTH
      if (lines[1]) HEIGHT = parseInt(lines[1]) || HEIGHT
      if (lines[2]) {
        const rf = lines[2]
        const parts = rf.split('/')
        if (parts.length === 2) FPS = Math.round(parseFloat(parts[0]) / parseFloat(parts[1])) || FPS
        else FPS = Math.round(parseFloat(rf)) || FPS
      }
    } catch (e) { console.warn('[worker] ffprobe failed, using defaults for WIDTH/HEIGHT/FPS', e && e.message || e) }

    // build filter_complex per-segment; if a segment has zooms (based on original times), apply zoompan
    function buildZoomExprForLocal(zoomsLocal) {
      if (!zoomsLocal || !zoomsLocal.length) return null
      // sort by start
      zoomsLocal.sort((a,b) => a.start - b.start)
      // build nested if expression: if(between(t,ZS,ZE), expr, if(between(t,ZS2,ZE2), expr2, 1))
      let expr = '1'
      for (let i = zoomsLocal.length - 1; i >= 0; i--) {
        const z = zoomsLocal[i]
        const ZS = z.start.toFixed(3)
        const ZE = z.end.toFixed(3)
        const S = z.scale
        if (z.easing === 'easeInOut') {
          // p = (t-ZS)/(ZE-ZS); eased = 0.5*(1-cos(pi*p))
          const eased = `0.5*(1-cos(3.141592653589793*(t-${ZS})/(${ZE}-${ZS})))`
          const piece = `1+(${S}-1)*(${eased})`
          expr = `if(between(t,${ZS},${ZE}),${piece},${expr})`
        } else {
          const piece = `1+(${S}-1)*((t-${ZS})/(${ZE}-${ZS}))`
          expr = `if(between(t,${ZS},${ZE}),${piece},${expr})`
        }
      }
      return expr
    }

    let filter = ''
    const parts = merged.map((seg, idx) => {
      // find zooms overlapping this original segment (use safePlan.zooms original coords)
      const zoomsForSeg = (safePlan.zooms || []).map(z => ({ start: z.start, end: z.end, type: z.type, scale: z.scale, easing: z.easing, reason: z.reason })).filter(z => !(z.end <= seg.start || z.start >= seg.end)).map(z => ({ start: Math.max(0, z.start - seg.start), end: Math.min(seg.end - seg.start, z.end - seg.start), type: z.type, scale: z.scale, easing: z.easing, reason: z.reason }))
      if (!zoomsForSeg.length) {
        const vs = `[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${idx}];`
        const as = `[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${idx}];`
        return { vs, as }
      }
      // build zoom expression using local times
      const zoomExpr = buildZoomExprForLocal(zoomsForSeg)
      // center crop expressions x/y keep center
      const xExpr = `iw/2-(iw/zoom/2)`
      const yExpr = `ih/2-(ih/zoom/2)`
      const vs = `[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS,zoompan=z='${zoomExpr.replace(/'/g, "\\'") }':x='${xExpr}':y='${yExpr}':d=1:s=${WIDTH}x${HEIGHT}:fps=${FPS}[v${idx}];`
      const as = `[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${idx}];`
      return { vs, as }
    })

    filter = parts.map(p => p.vs + p.as).join('')
    const concatInputs = merged.map((_, idx) => `[v${idx}][a${idx}]`).join('')
    const concat = `${concatInputs}concat=n=${merged.length}:v=1:a=1[outv][outa]`
    const fullFilter = filter + concat
    jlog('ffmpeg_filter_complex', { filter: fullFilter.slice ? fullFilter.slice(0,1000) : String(fullFilter) })

    const ffCmd = `ffmpeg -y -i "${localIn}" -filter_complex "${fullFilter}" -map "[outv]" -map "[outa]" -c:v libx264 -preset veryfast -crf 23 -c:a aac -movflags +faststart "${localOut}"`
    jlog('ffmpeg_render_cmd', { cmd: ffCmd.slice ? ffCmd.slice(0,1000) : String(ffCmd) })
    try {
      const rr = await runShellCommand(ffCmd, { timeoutMs: 15 * 60 * 1000 })
      if (rr.stderr) log('FFMPEG STDERR', rr.stderr.slice(-2000))
      if (rr.stdout) log('FFMPEG STDOUT', rr.stdout.slice(-2000))
      log('FFMPEG DONE render', { code: rr.code })
    } catch (e) {
      log('FFMPEG render failed', e && (e.message || e))
      throw e
    }
    log('FFMPEG DONE')
    jlog('render_finished', { output: localOut })

    // Upload result.json first (small, quick)
    const destResultPath = `results/${jobId}/result.json`
    jlog('upload_result_json_start', { dest: destResultPath })
      jlog('stage_upload')
    // mark uploading phase before the potentially-long upload
    try { await updateJobPatch({ phase: 'UPLOADING', progress: clampProgress(95), message: 'Uploading results', updatedAt: admin.firestore.FieldValue.serverTimestamp() }) } catch (e) { jlog('failed_set_phase_uploading', { message: e && e.message }) }

    let resultUrl = null
    try {
      resultUrl = await uploadToBucket(localResult, destResultPath)
    } catch (e) {
      console.warn(`[worker:${jobId}] failed to upload result.json`, e && (e.message || e))
    }

    // If a local output file exists, upload it to outputs/<userId>/<jobId>.mp4
    const userIdForPath = (jobDoc && jobDoc.userId) ? String(jobDoc.userId) : 'anonymous'
    const outputPath = `outputs/${userIdForPath}/${jobId}.mp4`
    let outputUrl = null
    let uploaded = false
    try {
      if (fs.existsSync(localOut)) {
        const bucketObj = getBucketObject()
        jlog('upload_output_start', { dest: outputPath })
        console.log(`[worker] uploading output ${localOut} -> ${outputPath}`)
        await bucketObj.upload(localOut, { destination: outputPath, metadata: { contentType: 'video/mp4' } })
        // verify object exists
        const f = bucketObj.file(outputPath)
        let exists = false
        try {
          const existsRes = await f.exists()
          exists = Array.isArray(existsRes) ? existsRes[0] : !!existsRes
        } catch (ee) { exists = false }
        console.log(`[worker] file exists: ${exists} for ${outputPath}`)
        if (!exists) throw new Error('Output upload failed: object not found after upload')
        uploaded = true
        try {
          const { getSignedUrlDetailed } = require('../../utils/storageSignedUrl')
          const signRes = await getSignedUrlDetailed(outputPath, 60)
          if (signRes && signRes.success) {
            outputUrl = signRes.url
          } else {
            console.warn('[worker] signing failed for output', { jobId, outputPath, signing: signRes })
            outputUrl = null
            try { await updateJobPatch({ signingError: signRes && signRes.error || null, signingDebug: signRes && signRes.debug || null }) } catch (ee) {}
          }
        } catch (err) {
          console.warn('[worker] failed to generate signed URL for video (exception)', err && (err.message || err))
          outputUrl = null
          try { await updateJobPatch({ signingError: err && (err.message || String(err)), signingDebug: null }) } catch (ee) {}
        }
      } else {
        console.warn(`[worker:${jobId}] no local output file found at ${localOut}; skipping video upload`)
      }
    } catch (e) {
      console.error(`[worker:${jobId}] failed to upload output video`, e && (e.stack || e.message || e))
      try {
        await db.collection('jobs').doc(jobId).set({ status: sanitizeStatus('failed'), phase: 'FAILED', progress: 0, errorMessage: e && (e.message || String(e)), errorStack: (e && e.stack) ? String(e.stack).slice(0,2000) : null, failedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
        jlog('job_db_updated_failed', { reason: 'upload_failed', error: e && (e.message || String(e)) })
      } catch (ee) { jlog('failed_to_write_upload_error', { message: ee && ee.message }) }
      return { resultUrl: null, finalVideoPath: null }
    }

    // Update job doc: include output path and signed URLs for download if available
  const jobUpdateBase = {
      progress: 100,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      message: 'Completed',
      resultUrl: outputUrl || resultUrl || null,
      resultPath: outputPath || null,
      finalVideoPath: outputPath || null,
      // keep both legacy and explicit fields for compatibility
      outputUrl: outputUrl || null,
      outputPath: outputPath || null,
    }
    jlog('stage_finalize')
    // Mark completed when the output was uploaded (preferred) or when a small result.json exists.
    if (uploaded || jobUpdateBase.resultUrl) {
      const jobUpdate = Object.assign({ status: 'completed', phase: 'COMPLETED' }, jobUpdateBase)
      try {
        await db.collection('jobs').doc(jobId).set(jobUpdate, { merge: true })
        jlog('job_db_updated', { resultPath: outputPath, outputPath: outputPath, uploaded })
        console.log(`[worker] wrote resultPath ${outputPath} for ${jobId}`)
        console.log('[worker] marked completed', jobId)
      } catch (e) {
        jlog('job_db_update_failed', { error: e && e.message })
      }
      // Return result info for worker to perform a final canonical update
      return { resultUrl: jobUpdate.resultUrl || null, finalVideoPath: jobUpdate.finalVideoPath || null }
    } else {
      const errMsg = 'Processing finished but no output uploaded or result URL generated'
      const failedUpdate = Object.assign({ status: sanitizeStatus('failed'), phase: 'FAILED', progress: 0, error: errMsg, errorMessage: errMsg, message: errMsg, failedAt: admin.firestore.FieldValue.serverTimestamp() }, jobUpdateBase)
      await db.collection('jobs').doc(jobId).set(failedUpdate, { merge: true })
      jlog('job_db_updated_failed', { reason: errMsg, outputPath: outputPath })
      return { resultUrl: null, finalVideoPath: null }
    }

    // cleanup
    try { fs.unlinkSync(localIn) } catch (e) {}
    try { fs.unlinkSync(localResult) } catch (e) {}

  } catch (err) {
    const errMsg = err && (err.message || String(err))
    const errStack = err && (err.stack || null)
    jlog('job_error', { message: errMsg, stack: errStack })
    try {
      if (db) await db.collection('jobs').doc(jobId).set({ status: sanitizeStatus('failed'), progress: 0, error: errMsg || String(err), errorMessage: errMsg, errorStack: errStack, failedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), message: errMsg || 'Processing error' }, { merge: true })
    } catch (e) {
      jlog('failed_to_write_error', { message: e && (e.message || String(e)) })
    }
  }
}

module.exports = { processJob }
