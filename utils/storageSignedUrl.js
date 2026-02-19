const { admin, bucket } = require('../services/firebaseAdmin')
const DEFAULT_BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET ? String(process.env.FIREBASE_STORAGE_BUCKET).replace(/^gs:\/\//i, '').trim() : null

function getBucketObj(name) {
  if (name) return admin.storage().bucket(name)
  if (bucket) return bucket
  if (DEFAULT_BUCKET_NAME) return admin.storage().bucket(DEFAULT_BUCKET_NAME)
  return admin.storage().bucket()
}

function _normalizePath(p) {
  if (!p || typeof p !== 'string') return ''
  let s = p.trim()
  // remove leading gs://bucket/ if present
  s = s.replace(/^gs:\/\/[\w.-]+\//i, '')
  // remove leading slashes
  s = s.replace(/^\/+/, '')
  // collapse multiple slashes
  s = s.replace(/\/+/g, '/')
  return s
}

async function getSignedUrlDetailed(objectPath, expiresMinutes = 30, bucketName = null) {
  const attempted = { path: objectPath, bucket: null, fileExists: false }
  try {
    const normalized = _normalizePath(objectPath)
    if (!normalized) return { success: false, url: null, error: 'Output file missing before signing' }

    const useBucket = bucketName ? admin.storage().bucket(bucketName) : getBucketObj()
    const resolvedBucketName = (useBucket && useBucket.name) ? useBucket.name : (bucketName || DEFAULT_BUCKET_NAME || null)
    attempted.bucket = resolvedBucketName

    const file = useBucket.file(normalized)
    let [exists] = await file.exists()
    if (!exists) {
      // try alternate normalization (remove duplicate segments)
      const alt = normalized.replace(/(^|\/)\.+(\/|$)/g, '/')
      if (alt !== normalized) {
        const altFile = useBucket.file(alt)
        const [altExists] = await altFile.exists()
        if (altExists) {
          attempted.path = alt
          exists = true
        }
      }
    }

    if (!exists) {
      attempted.fileExists = false
      return { success: false, url: null, error: `Output file missing before signing: attemptedPath=${normalized}`, debug: attempted }
    }
    attempted.fileExists = true

    const expiresMs = Date.now() + (expiresMinutes || 30) * 60 * 1000
    const expires = new Date(expiresMs)

    try {
      const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires })
      return { success: true, url, error: null }
    } catch (err) {
      // retry once after re-normalizing/encoding
      try {
        const retryPath = encodeURI(normalized)
        attempted.path = retryPath
        const retryFile = useBucket.file(retryPath)
        const [retryExists] = await retryFile.exists()
        if (!retryExists) {
          attempted.fileExists = false
          return { success: false, url: null, error: `Output file missing before signing on retry: ${retryPath}`, debug: attempted }
        }
        attempted.fileExists = true
        const [url2] = await retryFile.getSignedUrl({ version: 'v4', action: 'read', expires })
        return { success: true, url: url2, error: null, debug: attempted }
      } catch (err2) {
        const msg = err2 && err2.message ? err2.message : String(err2)
        return { success: false, url: null, error: `Signing failed. attemptedPath=${attempted.path} exists=true bucket=${attempted.bucket} error=${msg}`, debug: attempted }
      }
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    return { success: false, url: null, error: `Signing failed pre-check: ${msg}`, debug: attempted }
  }
}

// Backwards compatible simple wrapper that throws on error
async function getSignedUrlForPath(objectPath, expiresMinutes = 30, bucketName = null) {
  const res = await getSignedUrlDetailed(objectPath, expiresMinutes, bucketName)
  if (res.success) return res.url
  const err = new Error(res.error || 'failed_to_generate_signed_url')
  throw err
}

function _extractPathFromStorageUrl(url) {
  if (!url || typeof url !== 'string') return null
  // normalize: remove whitespace/newlines that may have been introduced
  const cleaned = url.replace(/\s+/g, '')
  // match https://storage.googleapis.com/<bucket>/<path>
  const m = cleaned.match(/^https?:\/\/storage.googleapis.com\/(?:([^\/]+)\/)?(.+)$/i)
  if (!m) return null
  const bucket = m[1] || null
  const path = m[2]
  return { bucket, path }
}

async function attachSignedUrlsToJob(job, expiresMinutes = 30) {
  if (!job) return job
  const cloned = Object.assign({}, job)
  const bucket = getBucketObj()

    try {
    // resultUrl (common case for small JSON result)
    if (!cloned.resultUrl) {
      const guess = `results/${cloned.id}/result.json`
      const f = bucket.file(guess)
      const [exists] = await f.exists()
      if (exists) {
        const out = await getSignedUrlDetailed(guess, expiresMinutes)
        if (out.success) cloned.resultUrl = out.url
        else console.warn('[storageSignedUrl] result.json signing failed', out.error)
      }
    } else if (cloned.resultUrl && cloned.resultUrl.includes('storage.googleapis.com')) {
      const parsed = _extractPathFromStorageUrl(cloned.resultUrl)
      if (parsed && parsed.path) {
        try {
          const useBucket = parsed.bucket ? admin.storage().bucket(parsed.bucket) : bucket
          const f = useBucket.file(parsed.path)
          const [exists] = await f.exists()
          if (exists) {
            const out = await getSignedUrlDetailed(parsed.path, expiresMinutes, parsed.bucket)
            if (out.success) cloned.resultUrl = out.url
            else console.warn('[storageSignedUrl] failed to generate signed URL for resultUrl path', parsed.bucket || DEFAULT_BUCKET_NAME, parsed.path, out.error)
          }
        } catch (e) {}
      }
    }

    // final video path
    if (cloned.finalVideoPath && (!cloned.videoUrl || (cloned.videoUrl && cloned.videoUrl.includes('storage.googleapis.com')))) {
      try {
        const f = bucket.file(cloned.finalVideoPath)
        const [exists] = await f.exists()
        if (exists) {
          const out = await getSignedUrlDetailed(cloned.finalVideoPath, expiresMinutes)
          if (out.success) cloned.videoUrl = out.url
          else console.warn('[storageSignedUrl] failed to generate signed URL for finalVideoPath', cloned.finalVideoPath, out.error)
        }
      } catch (e) {}
    }

    // If this job has a final video, prefer that as the canonical result URL
    if (cloned.finalVideoPath && cloned.videoUrl) {
      // Only override resultUrl when it's missing or points to a results JSON
      if (!cloned.resultUrl || (typeof cloned.resultUrl === 'string' && cloned.resultUrl.includes('/results/'))) {
        cloned.resultUrl = cloned.videoUrl
      }
    }

    // resultUrls map (older route may store multiple)
    if (cloned.resultUrls && typeof cloned.resultUrls === 'object') {
      const out = Object.assign({}, cloned.resultUrls)
      for (const k of Object.keys(out)) {
        const v = out[k]
        if (v && typeof v === 'string') {
          // if it's a storage path (no host) or a storage.googleapis.com url
          let objPath = null
          let objBucket = null
          if (v.startsWith('outputs/') || v.startsWith('results/') || v.startsWith('uploads/')) {
            objPath = v
          } else if (v.includes('storage.googleapis.com')) {
            const parsed = _extractPathFromStorageUrl(v)
            if (parsed && parsed.path) {
              objPath = parsed.path
              objBucket = parsed.bucket || null
            }
          }

          if (objPath) {
            try {
              const useBucket = objBucket ? admin.storage().bucket(objBucket) : bucket
              const f = useBucket.file(objPath)
              const [exists] = await f.exists()
              if (exists) {
                const signed = await getSignedUrlDetailed(objPath, expiresMinutes, objBucket)
                if (signed.success) out[k] = signed.url
                else {
                  console.warn('[storageSignedUrl] failed to generate signed URL for resultUrls key', k, objBucket || DEFAULT_BUCKET_NAME, objPath, signed.error)
                  out[k] = v
                }
              }
            } catch (e) {}
          }
        }
      }
      cloned.resultUrls = out
    }
  } catch (e) {
    // don't throw for response-time URL generation failures
  }

  return cloned
}

module.exports = { getSignedUrlForPath, getSignedUrlDetailed, attachSignedUrlsToJob }
