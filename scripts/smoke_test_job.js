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
