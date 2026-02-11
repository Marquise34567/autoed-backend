import admin, { getFirestore } from './firebaseAdmin'

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
  await docRef.set(base)
  return base
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const db = getFirestore()
  const docRef = db.collection(COLLECTION).doc(id)
  const doc = await docRef.get()
  if (!doc.exists) return null
  const data = (doc.data() || {}) as JobRecord
  const { job, cleanupPatch } = sanitizeJobRead(data)
  if (cleanupPatch) {
    try {
      await docRef.set(cleanupPatch, { merge: true })
    } catch (_) {
      // ignore cleanup failures
    }
  }
  return job
}

export async function updateJob(id: string, patch: Partial<JobRecord>) {
  const db = getFirestore()
  const docRef = db.collection(COLLECTION).doc(id)
  const snap = await docRef.get()
  if (!snap.exists) {
    return null
  }
  const current = snap.data() || {}
  const { job: cleanedCurrent, cleanupPatch } = sanitizeJobRead(current as JobRecord)
  const sanitized = sanitizeJobPatch(patch)
  const next = { ...cleanedCurrent, ...sanitized, updatedAt: now() }
  const writePayload = cleanupPatch ? { ...next, ...cleanupPatch } : next
  await docRef.set(writePayload, { merge: true })
  return next as JobRecord
}

export async function appendJobLog(id: string, message: string) {
  const db = getFirestore()
  const docRef = db.collection(COLLECTION).doc(id)
  const snap = await docRef.get()
  const current = snap.exists ? (snap.data() || {}) : {}
  const logs = Array.isArray(current.logs) ? [...current.logs, message] : [message]
  const next = { ...current, logs, updatedAt: now() }
  await docRef.set(next, { merge: true })
  return next as JobRecord
}

function sanitizeJobPatch(patch: Partial<JobRecord>) {
  const next: Partial<JobRecord> = { ...patch }
  // Never persist signed URLs or legacy downloadUrl fields
  if ('downloadUrl' in (next as any)) delete (next as any).downloadUrl

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

  if (typeof (next as any).downloadUrl === 'string') {
    delete (next as any).downloadUrl
    cleanup.downloadUrl = admin.firestore.FieldValue.delete()
  }

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
