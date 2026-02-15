import admin, { getFirestore, withTimeout } from './firebaseAdmin'

type JobRecord = {
  id: string
  uid?: string
  phase?: string
  overallProgress?: number
  overallEtaSec?: number | null
  message?: string
  createdAt?: number
  updatedAt?: number
  objectPathOriginal?: string
  objectPathNormalized?: string
  /** Canonical storage path for the final render (no signed URLs) */
  finalVideoPath?: string
  /** Legacy field; avoid writing new values */
  objectPathOutput?: string
  error?: string | null
  logs?: string[]
  [k: string]: any
}

const COLLECTION = 'jobs'

function now() {
  return Date.now()
}

export async function createJob(job: JobRecord) {
  const db = getFirestore()
  const docRef = db.collection(COLLECTION).doc(job.id)
  const finalVideoPath =
    typeof job.finalVideoPath === 'string' && job.finalVideoPath
      ? job.finalVideoPath
      : typeof job.objectPathOutput === 'string' && job.objectPathOutput
        ? job.objectPathOutput
        : null
  const base: JobRecord = {
    id: job.id,
    uid: job.uid,
    phase: job.phase || 'UPLOADING',
    overallProgress: typeof job.overallProgress === 'number' ? job.overallProgress : 0,
    overallEtaSec: job.overallEtaSec ?? null,
    message: job.message || 'Created',
    createdAt: job.createdAt || now(),
    updatedAt: now(),
    objectPathOriginal: job.objectPathOriginal || null,
    objectPathNormalized: job.objectPathNormalized || null,
    finalVideoPath,
    error: job.error || null,
    logs: job.logs || [],
  }
  try {
    await withTimeout(docRef.set(base), 10000)
    return base
  } catch (err) {
    console.error('[FIRESTORE_ERROR]', {
      message: err?.message,
      code: err?.code,
      details: err?.details,
      stack: err?.stack,
      raw: err,
    })
    throw err
  }
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const db = getFirestore()
  const docRef = db.collection(COLLECTION).doc(id)
  let doc
  try {
    doc = await withTimeout(docRef.get(), 10000)
  } catch (err) {
    console.error('[FIRESTORE_ERROR]', {
      message: err?.message,
      code: err?.code,
      details: err?.details,
      stack: err?.stack,
      raw: err,
    })
    throw err
  }
  if (!doc.exists) return null
  const data = (doc.data() || {}) as JobRecord
  const { job, cleanupPatch } = sanitizeJobRead(data)
  if (cleanupPatch) {
    try {
      await withTimeout(docRef.set(cleanupPatch, { merge: true }), 8000)
    } catch (e) {
      console.warn('[FIRESTORE_CLEANUP_FAILED]', e && e.message ? e.message : e)
    }
  }
  // Attach signed URLs for client consumption (do not persist)
  try {
    const withUrls = await attachSignedUrlsToJob(job, 30)
    return withUrls
  } catch (e) {
    console.warn('[ATTACH_URLS_FAILED]', e && e.message ? e.message : e)
    return job
  }
}

async function attachSignedUrlsToJob(job: JobRecord, expiresMinutes = 30): Promise<JobRecord> {
  if (!job) return job
  const cloned: JobRecord = { ...job }
  try {
    const bucket = admin.storage().bucket()
    // final video path -> videoUrl
    if (cloned.finalVideoPath) {
      try {
        const f = bucket.file(cloned.finalVideoPath)
        const [exists] = await f.exists()
        if (exists) {
          const expires = new Date(Date.now() + (expiresMinutes || 30) * 60 * 1000)
          const [url] = await f.getSignedUrl({ version: 'v4', action: 'read', expires })
          ;(cloned as any).videoUrl = url
        }
      } catch (_) {}
    }

    // result.json guess
    try {
      const guess = `results/${cloned.id}/result.json`
      const f2 = bucket.file(guess)
      const [exists2] = await f2.exists()
      if (exists2) {
        const expires = new Date(Date.now() + (expiresMinutes || 30) * 60 * 1000)
        const [url2] = await f2.getSignedUrl({ version: 'v4', action: 'read', expires })
        ;(cloned as any).resultUrl = url2
      }
    } catch (_) {}

    // resultUrls map
    if ((cloned as any).resultUrls && typeof (cloned as any).resultUrls === 'object') {
      const out: Record<string, any> = {}
      for (const k of Object.keys((cloned as any).resultUrls)) {
        const v = (cloned as any).resultUrls[k]
        if (typeof v === 'string') {
          try {
            let path = null as string | null
            if (v.startsWith('results/') || v.startsWith('outputs/') || v.startsWith('uploads/')) path = v
            else if (v.includes('storage.googleapis.com')) {
              const m = v.match(/^https?:\/\/storage.googleapis.com\/(?:[^\/]+)\/(.+)$/i)
              if (m) path = m[1]
            }
            if (path) {
              const f3 = bucket.file(path)
              const [exists3] = await f3.exists()
              if (exists3) {
                const expires = new Date(Date.now() + (expiresMinutes || 30) * 60 * 1000)
                const [u] = await f3.getSignedUrl({ version: 'v4', action: 'read', expires })
                out[k] = u
                continue
              }
            }
          } catch (_) {}
        }
        out[k] = v
      }
      ;(cloned as any).resultUrls = out
    }
  } catch (e) {
    // ignore failures
  }
  return cloned
}

export async function updateJob(id: string, patch: Partial<JobRecord>) {
  const db = getFirestore()
  const docRef = db.collection(COLLECTION).doc(id)
  let snap
  try {
    snap = await withTimeout(docRef.get(), 10000)
  } catch (err) {
    console.error('[FIRESTORE_ERROR]', {
      message: err?.message,
      code: err?.code,
      details: err?.details,
      stack: err?.stack,
      raw: err,
    })
    throw err
  }
  if (!snap.exists) {
    return null
  }
  const current = snap.data() || {}
  const { job: cleanedCurrent, cleanupPatch } = sanitizeJobRead(current as JobRecord)
  const sanitized = sanitizeJobPatch(patch)
  const next = { ...cleanedCurrent, ...sanitized, updatedAt: now() }
  const writePayload = cleanupPatch ? { ...next, ...cleanupPatch } : next
  try {
    await withTimeout(docRef.set(writePayload, { merge: true }), 10000)
  } catch (err) {
    console.error('[FIRESTORE_ERROR]', {
      message: err?.message,
      code: err?.code,
      details: err?.details,
      stack: err?.stack,
      raw: err,
    })
    throw err
  }
  return next as JobRecord
}

export async function appendJobLog(id: string, message: string) {
  const db = getFirestore()
  const docRef = db.collection(COLLECTION).doc(id)
  let snap
  try {
    snap = await withTimeout(docRef.get(), 8000)
  } catch (err) {
    console.error('[FIRESTORE_ERROR]', {
      message: err?.message,
      code: err?.code,
      details: err?.details,
      stack: err?.stack,
      raw: err,
    })
    throw err
  }
  const current = snap.exists ? (snap.data() || {}) : {}
  const logs = Array.isArray(current.logs) ? [...current.logs, message] : [message]
  const next = { ...current, logs, updatedAt: now() }
  try {
    await withTimeout(docRef.set(next, { merge: true }), 10000)
  } catch (err) {
    console.error('[FIRESTORE_ERROR]', {
      message: err?.message,
      code: err?.code,
      details: err?.details,
      stack: err?.stack,
      raw: err,
    })
    throw err
  }
  return next as JobRecord
}

function sanitizeJobPatch(patch: Partial<JobRecord>) {
  const next: Partial<JobRecord> = { ...patch }
  // Never persist signed URLs or legacy download URL fields
  // Keep explicit `downloadURL` if caller included it — worker prefers it when present.

  // Prefer canonical finalVideoPath and avoid writing legacy objectPathOutput
  if (!next.finalVideoPath && typeof (next as any).objectPathOutput === 'string') {
    next.finalVideoPath = (next as any).objectPathOutput
  }
  if ('objectPathOutput' in (next as any)) delete (next as any).objectPathOutput

  return next
}

function looksLikeUrl(value: string) {
  const v = value.trim()
  if (!v) return false
  if (v.includes('?')) return true
  return (
    v.includes('http://') ||
    v.includes('https://') ||
    v.includes('storage.googleapis.com') ||
    v.includes('GoogleAccessId=') ||
    v.includes('X-Goog-Algorithm') ||
    v.includes('X-Goog-Credential') ||
    v.includes('X-Goog-Signature')
  )
}

function sanitizeJobRead(job: JobRecord) {
  const next: JobRecord = { ...job }
  const cleanup: Record<string, any> = {}

  // Preserve any provided downloadURL/downloadUrl fields so the worker can use them.

  if (typeof next.objectPathOutput === 'string') {
    if (looksLikeUrl(next.objectPathOutput)) {
      delete (next as any).objectPathOutput
      cleanup.objectPathOutput = admin.firestore.FieldValue.delete()
    } else {
      if (!next.finalVideoPath) {
        next.finalVideoPath = next.objectPathOutput
        cleanup.finalVideoPath = next.objectPathOutput
      }
      delete (next as any).objectPathOutput
      cleanup.objectPathOutput = admin.firestore.FieldValue.delete()
    }
  }

  return { job: next, cleanupPatch: Object.keys(cleanup).length ? cleanup : null }
}

export default {
  createJob,
  getJob,
  updateJob,
  appendJobLog,
}

// Backwards-compat: many modules call setJob — alias to updateJob
export async function setJob(id: string, patch: Partial<JobRecord>) {
  return updateJob(id, patch)
}
