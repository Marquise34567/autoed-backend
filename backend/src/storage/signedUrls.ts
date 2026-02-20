import { getBucket } from '../firebaseAdmin'

export async function generateUploadSignedUrl(objectPath: string, contentType = 'application/octet-stream') {
  const bucket = getBucket()
  const file = bucket.file(objectPath)
  const expires = Date.now() + 60 * 60 * 1000 // 1 hour
  const [url] = await file.getSignedUrl({
    action: 'write',
    expires,
    contentType
  })
  return url
}

export async function generateDownloadSignedUrl(objectPath: string) {
  const bucket = getBucket()
  const file = bucket.file(objectPath)
  const expires = Date.now() + 60 * 60 * 1000
  const [url] = await file.getSignedUrl({ action: 'read', expires })
  return url
}
