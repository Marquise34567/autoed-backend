import express from 'express'
import { generateUploadSignedUrl, generateDownloadSignedUrl } from '../storage/signedUrls'
import { createJob, getJob } from './jobs.service'

const router = express.Router()

router.post('/uploads/sign', async (req, res) => {
  try {
    const { filename, contentType, bucket } = req.body
    const objectPath = `${Date.now()}_${filename}`
    const uploadUrl = await generateUploadSignedUrl(objectPath, contentType)
    res.json({ ok: true, uploadUrl, objectPath, bucket: bucket || process.env.FIREBASE_STORAGE_BUCKET })
  } catch (e) {
    console.error(e)
    res.status(500).json({ ok: false, error: 'SIGN_FAILED' })
  }
})

router.post('/jobs', async (req, res) => {
  try {
    const { objectPath, bucket } = req.body
    const job = await createJob({ inputBucket: bucket || process.env.FIREBASE_STORAGE_BUCKET || '', inputPath: objectPath, outputBucket: bucket || process.env.FIREBASE_STORAGE_BUCKET || '' })
    res.json({ ok: true, jobId: job.id, status: job.status })
  } catch (e) {
    console.error(e)
    res.status(500).json({ ok: false, error: 'CREATE_JOB_FAILED' })
  }
})

router.get('/jobs/:id', async (req, res) => {
  try {
    const job = await getJob(req.params.id)
    if (!job) return res.status(404).json({ ok: false, error: 'NOT_FOUND' })
    res.json({ ok: true, job })
  } catch (e) {
    console.error(e)
    res.status(500).json({ ok: false })
  }
})

router.get('/jobs/:id/download', async (req, res) => {
  try {
    const job = await getJob(req.params.id)
    if (!job) return res.status(404).json({ ok: false, error: 'NOT_FOUND' })
    if (job.status !== 'DONE' || !job.outputPath) return res.status(400).json({ ok: false, error: 'NOT_READY' })
    const url = await generateDownloadSignedUrl(job.outputPath)
    res.json({ ok: true, downloadUrl: url })
  } catch (e) {
    console.error(e)
    res.status(500).json({ ok: false, error: 'DOWNLOAD_FAILED' })
  }
})

export default router
