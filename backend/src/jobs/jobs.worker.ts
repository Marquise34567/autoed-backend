import { WORKER_ENABLED } from '../env'
import { findNextQueued, markDone, markError } from './jobs.service'
import { getBucket } from '../firebaseAdmin'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const POLL_MS = 2000

async function processJobLoop() {
  if (!WORKER_ENABLED) {
    console.log('[worker] disabled by env')
    return
  }
  console.log('[worker] starting loop')
  while (true) {
    try {
      const job = await findNextQueued()
      if (!job) {
        await new Promise(r => setTimeout(r, POLL_MS))
        continue
      }
      console.log('[worker] picked job', job.id)
      const tmpIn = path.join('/tmp', `in_${job.id}`)
      const tmpOut = path.join('/tmp', `out_${job.id}.mp4`)
      const bucket = getBucket()
      // download
      await bucket.file(job.inputPath).download({ destination: tmpIn })
      // run ffmpeg: very simple transcode to mp4
      await new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', ['-y', '-i', tmpIn, '-c:v', 'libx264', '-preset', 'fast', tmpOut])
        ff.stdout.on('data', d => console.log('[ffmpeg]', d.toString()))
        ff.stderr.on('data', d => console.log('[ffmpeg]', d.toString()))
        ff.on('error', reject)
        ff.on('close', code => code === 0 ? resolve(null) : reject(new Error('ffmpeg failed ' + code)))
      })
      // upload
      const outPath = `outputs/${job.id}.mp4`
      await bucket.upload(tmpOut, { destination: outPath })
      await markDone(job.id, outPath)
      try { fs.unlinkSync(tmpIn) } catch (e) {}
      try { fs.unlinkSync(tmpOut) } catch (e) {}
    } catch (e: any) {
      console.error('[worker] job processing error', e && e.message)
      // If job exists and has id, mark error
      try {
        if (e && e.jobId) await markError(e.jobId, String(e.message || e))
      } catch (er) { console.error(er) }
      await new Promise(r => setTimeout(r, POLL_MS))
    }
  }
}

export { processJobLoop }
