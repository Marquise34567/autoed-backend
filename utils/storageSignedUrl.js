const admin = require('./firebaseAdmin')

async function getSignedUrlForPath(objectPath, expiresMinutes = 30, bucketName = null) {
  if (!objectPath) throw new Error('Missing objectPath')
  // allow explicit bucketName override
  const bucket = bucketName ? admin.getBucket(bucketName) : admin.getBucket()
  const file = bucket.file(objectPath)
  const [exists] = await file.exists()
  if (!exists) throw new Error('Storage object not found: ' + (bucketName ? `${bucketName}/${objectPath}` : objectPath))
  const expiresMs = Date.now() + (expiresMinutes || 30) * 60 * 1000
  const expires = new Date(expiresMs)
  const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires })
  return url
}

function _extractPathFromStorageUrl(url) {
  if (!url || typeof url !== 'string') return null
  // match https://storage.googleapis.com/<bucket>/<path>
  const m = url.match(/^https?:\/\/storage.googleapis.com\/(?:([^\/]+)\/)??(.+)$/i)
  if (!m) return null
  const bucket = m[1] || null
  const path = m[2]
  return { bucket, path }
}

async function attachSignedUrlsToJob(job, expiresMinutes = 30) {
  if (!job) return job
  const cloned = Object.assign({}, job)
  const bucket = admin.getBucket()

  try {
    // resultUrl (common case for small JSON result)
    if (!cloned.resultUrl) {
      const guess = `results/${cloned.id}/result.json`
      const f = bucket.file(guess)
      const [exists] = await f.exists()
      if (exists) {
        cloned.resultUrl = await getSignedUrlForPath(guess, expiresMinutes)
      }
    } else if (cloned.resultUrl && cloned.resultUrl.includes('storage.googleapis.com')) {
      const parsed = _extractPathFromStorageUrl(cloned.resultUrl)
      if (parsed && parsed.path) {
        try {
          const useBucket = parsed.bucket ? admin.getBucket(parsed.bucket) : bucket
          const f = useBucket.file(parsed.path)
          const [exists] = await f.exists()
          if (exists) {
            try {
              cloned.resultUrl = await getSignedUrlForPath(parsed.path, expiresMinutes, parsed.bucket)
            } catch (err) {
              console.warn('[storageSignedUrl] failed to generate signed URL for resultUrl path', parsed.bucket || admin.getBucketName && admin.getBucketName(), parsed.path, err && err.message ? err.message : err)
            }
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
          try {
            cloned.videoUrl = await getSignedUrlForPath(cloned.finalVideoPath, expiresMinutes)
          } catch (err) {
            console.warn('[storageSignedUrl] failed to generate signed URL for finalVideoPath', cloned.finalVideoPath, err && err.message ? err.message : err)
          }
        }
      } catch (e) {}
    }

    // resultUrls map (older route may store multiple)
    if (cloned.resultUrls && typeof cloned.resultUrls === 'object') {
      const out = Object.assign({}, cloned.resultUrls)
      for (const k of Object.keys(out)) {
        const v = out[k]
        if (v && typeof v === 'string') {
          // if it's a storage path (no host) or a storage.googleapis.com url
          let objPath = null
          if (v.startsWith('outputs/') || v.startsWith('results/') || v.startsWith('uploads/')) objPath = v
          else if (v.includes('storage.googleapis.com')) objPath = _extractPathFromStorageUrl(v)
          if (objPath) {
            try {
              const f = bucket.file(objPath)
              const [exists] = await f.exists()
              if (exists) {
                try {
                  out[k] = await getSignedUrlForPath(objPath, expiresMinutes)
                } catch (err) {
                  console.warn('[storageSignedUrl] failed to generate signed URL for resultUrls key', k, objPath, err && err.message ? err.message : err)
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

module.exports = { getSignedUrlForPath, attachSignedUrlsToJob }
