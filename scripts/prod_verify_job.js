const { admin, db } = require('../services/firebaseAdmin')
const { getSignedUrlForPath } = require('../utils/storageSignedUrl')
const crypto = require('crypto')

async function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

async function main(){
  const storagePath = 'test-inputs/prod-test.mp4'
  const contentType = 'video/mp4'
  const jobId = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.floor(Math.random()*100000)}`
  console.log('Creating job', jobId)
  const now = admin.firestore.FieldValue.serverTimestamp()
  const docRef = db.collection('jobs').doc(jobId)
  const payload = {
    id: jobId,
    status: 'queued',
    progress: 0,
    createdAt: now,
    updatedAt: now,
    input: { storagePath },
    inputSpec: { storagePath },
    filename: null,
    contentType: contentType,
    lockedAt: null,
    workerId: null,
    errorMessage: null,
  }
  await docRef.set(payload, { merge: true })
  console.log('Job created; now polling for status...')

  const maxPoll = 60 * 30 // up to 30 minutes
  for (let i=0;i<maxPoll;i++){
    const snap = await docRef.get()
    const data = snap.exists ? snap.data() : null
    console.log(new Date().toISOString(), 'poll', i, data && data.status)
    if (data && (String(data.status).toLowerCase() === 'completed' || String(data.status).toLowerCase() === 'failed')){
      console.log('Final job doc:', JSON.stringify(data, null, 2))
      if (data.resultUrl) console.log('resultUrl:', data.resultUrl)
      if (String(data.status).toLowerCase() === 'completed' && !data.resultUrl){
        const finalPath = data.finalVideoPath || data.outputPath || data.outputFile || `results/${jobId}/output.mp4`
        console.log('finalPath guess:', finalPath)
        try {
          const url = await getSignedUrlForPath(finalPath, 60)
          console.log('Signed URL:', url)
          const file = admin.storage().bucket().file(finalPath)
          const [meta] = await file.getMetadata()
          console.log('Storage metadata size:', meta && meta.size)
        } catch (e) {
          console.error('Failed to fetch signed URL or metadata', e && (e.message || e))
        }
      }
      return
    }
    await sleep(3000)
  }
  console.error('Timed out waiting for job')
}

main().catch(e=>{console.error('ERR', e && e.stack || e); process.exit(1)})
