const admin = require('../services/firebaseAdmin')
const db = admin && (admin.db || (typeof admin.firestore === 'function' ? admin.firestore() : null))

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function run() {
  if (!db) { console.error('firebase admin not configured'); process.exit(2) }
  const jobId = `smoke-${Date.now()}`
  console.log('creating smoke job', jobId)
  const now = admin.firestore.FieldValue.serverTimestamp()
  await db.collection('jobs').doc(jobId).set({ id: jobId, status: 'queued', progress: 0, createdAt: now, updatedAt: now, inputPath: 'smoke/no-op' })
  const deadline = Date.now() + (5 * 60 * 1000)
  while (Date.now() < deadline) {
    const snap = await db.collection('jobs').doc(jobId).get()
    if (!snap.exists) { console.error('job disappeared'); process.exit(2) }
    const j = snap.data() || {}
    console.log('status=', j.status, 'progress=', j.progress)
    if (j.status === 'completed') {
      if (!j.resultUrl) { console.error('completed but missing resultUrl'); process.exit(3) }
      console.log('smoke test success, resultUrl=', j.resultUrl)
      process.exit(0)
    }
    if (j.status === 'failed') {
      console.log('smoke test job failed, errorMessage=', j.errorMessage || j.error || 'none')
      process.exit(0)
    }
    await sleep(3000)
  }
  console.error('smoke test timeout')
  process.exit(4)
}

run().catch(e => { console.error(e && (e.stack || e.message)); process.exit(10) })
#!/usr/bin/env node
const base = process.env.BACKEND_BASE || process.env.BACKEND_URL || 'http://localhost:3000'
const inputSpec = process.env.SMOKE_INPUT || process.env.INPUT || 'test-inputs/prod-test.mp4'
const pollMs = parseInt(process.env.SMOKE_POLL_MS || '3000', 10)
const maxPoll = parseInt(process.env.SMOKE_MAX_POLL || '600', 10) // max attempts

async function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

async function main(){
  console.log('SMOKE: backend base=', base)
  console.log('SMOKE: inputSpec=', inputSpec)
  // create job
  const postUrl = `${base.replace(/\/$/,'')}/api/jobs`
  const body = {}
  if (inputSpec.startsWith('gs://')) body.gsUri = inputSpec
  else if (inputSpec.startsWith('http')) body.downloadURL = inputSpec
  else body.storagePath = inputSpec
  console.log('SMOKE: POST', postUrl, body)
  const res = await fetch(postUrl, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body)})
  if (!res.ok) {
    console.error('POST failed', res.status, await res.text())
    process.exit(2)
  }
  const j = await res.json()
  if (!j || !j.jobId) {
    console.error('POST did not return jobId', j)
    process.exit(3)
  }
  const jobId = j.jobId
  console.log('SMOKE: created jobId=', jobId)

  // poll
  for (let i=0;i<maxPoll;i++){
    await sleep(pollMs)
    let statusRes
    try {
      statusRes = await fetch(`${base.replace(/\/$/,'')}/api/jobs?id=${jobId}`)
    } catch (e) { console.error('poll fetch error', e && e.message); continue }
    if (!statusRes.ok) { console.error('poll http error', statusRes.status); continue }
    const s = await statusRes.json()
    console.log('POLL', i, s && s.job && s.job.status)
    const st = s && s.job && s.job.status && String(s.job.status).toLowerCase()
    if (st === 'completed' || st === 'complete'){
      console.log('SMOKE: JOB COMPLETED', JSON.stringify(s.job, null, 2))
      process.exit(0)
    }
    if (st === 'failed'){
      console.log('SMOKE: JOB FAILED', JSON.stringify(s.job, null, 2))
      process.exit(5)
    }
  }
  console.error('SMOKE: timeout waiting for job')
  process.exit(6)
}

main().catch(e=>{console.error('SMOKE ERROR', e && e.stack || e); process.exit(99)})
