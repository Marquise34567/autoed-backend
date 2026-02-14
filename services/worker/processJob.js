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

    // Processing step: run retention-edit pipeline (transcribe -> AI plan -> trim+concat)
    console.log(`PROCESSING ${jobId}`)
    console.log(`[worker:${jobId}] running retention-edit pipeline on ${localIn}`)
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
        await db.collection('jobs').doc(jobId).set({ stage, progress: percent, message, updatedAt: Date.now() }, { merge: true })
      } catch (e) {}
    }

    // 1) Extract audio for transcription
    await setStage('Adding Hooks', 25, 'Extracting audio for transcription')
    const audioPath = path.resolve(outDir, `${jobId}-audio.wav`)
    const extractCmd = `ffmpeg -y -i "${localIn}" -vn -ac 1 -ar 16000 -hide_banner -loglevel error "${audioPath}"`
    console.log('[worker] extract audio cmd:', extractCmd)
    await new Promise((resolve, reject) => {
      exec(extractCmd, { maxBuffer: 1024 * 1024 * 20 }, (err) => err ? reject(err) : resolve())
    }).catch(e => { console.warn('[worker] audio extract failed', e && e.message || e) })

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
        const v = await new Promise((resolve, reject) => {
          exec(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${localIn}"`, (err, stdout) => err ? reject(err) : resolve(parseFloat(stdout.trim())))
        })
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
        console.log('[worker] AI plan:', JSON.stringify(aiPlan, null, 2))
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
        await new Promise((resolve, reject) => {
          const proc = exec(silCmd, { maxBuffer: 1024 * 1024 * 50 }, (err) => err ? reject(err) : resolve())
          if (proc.stderr) proc.stderr.on('data', (d) => { silOutput += String(d) })
        })
      } catch (e) { console.warn('[worker] silence detect failed', e && e.message || e) }
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
        try { const d = await new Promise((resolve, reject) => { exec(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${localIn}"`, (err, stdout) => err ? reject(err) : resolve(parseFloat(stdout.trim()))) },  ); if (Number.isFinite(d)) duration = d } catch (e) {}
      }
      if (Number.isFinite(duration)) {
        if (duration - cursor > 0.05) keepSegments.push({ start: cursor, end: duration, reason: 'tail' })
      } else {
        // nothing reliable; keep whole
        keepSegments.push({ start: 0, end: stat.size ? stat.size : 0, reason: 'fallback_whole' })
      }
      aiPlan = { hook: { start: 0, end: Math.min(4, keepSegments[0] ? (keepSegments[0].end - keepSegments[0].start) : 4), reason: 'fallback hook' }, keepSegments, removeSegments, notes: { pacing: 'fallback silence-tighten', warnings: [] } }
      console.log('[worker] fallback aiPlan', JSON.stringify(aiPlan, null, 2))
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
    console.log('[worker] finalSegments', JSON.stringify(merged, null, 2))

    if (!merged.length) throw new Error('No segments to render after AI plan/fallback')

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
    console.log('[worker] AI zooms (original, safePlan):', JSON.stringify(safePlan.zooms || [], null, 2))
    console.log('[worker] AI zooms (remapped to final timeline):', JSON.stringify(remappedZooms, null, 2))

    // 4) Render with ffmpeg trim+concat + zooms
    await setStage('Pacing', 80, 'Rendering final video with zooms')
    const localOut = path.resolve(outDir, `${jobId}-output.mp4`)

    // probe input for resolution/fps
    let WIDTH = 1280, HEIGHT = 720, FPS = 30
    try {
      const probeOut = await new Promise((resolve, reject) => {
        exec(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of default=noprint_wrappers=1:nokey=1 "${localIn}"`, (err, stdout) => err ? reject(err) : resolve(stdout))
      })
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
    console.log('[worker] ffmpeg filter_complex:', fullFilter)

    const ffCmd = `ffmpeg -y -i "${localIn}" -filter_complex "${fullFilter}" -map "[outv]" -map "[outa]" -c:v libx264 -preset veryfast -crf 23 -c:a aac -movflags +faststart "${localOut}"`
    console.log('[worker] ffmpeg render cmd:', ffCmd)
    await new Promise((resolve, reject) => {
      const proc = exec(ffCmd, { maxBuffer: 1024 * 1024 * 200 }, (err, stdout, stderr) => err ? reject(err) : resolve({ stdout, stderr }))
      if (proc.stdout) proc.stdout.on('data', (d) => console.log(`[worker:${jobId}] ffmpeg: ${String(d).trim()}`))
      if (proc.stderr) proc.stderr.on('data', (d) => console.log(`[worker:${jobId}] ffmpeg: ${String(d).trim()}`))
    })
    console.log(`[worker:${jobId}] render finished, output at ${localOut}`)

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
