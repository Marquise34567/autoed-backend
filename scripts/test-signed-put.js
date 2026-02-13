#!/usr/bin/env node
const https = require('https')
const http = require('http')
const { URL } = require('url')

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8080'
const filename = process.env.TEST_FILENAME || 'test-upload.txt'
const contentType = process.env.TEST_CONTENT_TYPE || 'text/plain'

async function postJson(path, body) {
  const u = new URL(path.startsWith('http') ? path : BACKEND + path)
  const lib = u.protocol === 'https:' ? https : http
  const data = JSON.stringify(body)
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }
  return new Promise((resolve, reject) => {
    const req = lib.request(u, opts, (res) => {
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', (d) => buf += d)
      res.on('end', () => resolve({ status: res.statusCode, body: buf }))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function putToSignedUrl(signedUrl, body, ct) {
  const u = new URL(signedUrl)
  const lib = u.protocol === 'https:' ? https : http
  const opts = { method: 'PUT', headers: { 'Content-Type': ct, 'Content-Length': Buffer.byteLength(body) } }
  return new Promise((resolve, reject) => {
    const req = lib.request(u, opts, (res) => {
      let b = ''
      res.setEncoding('utf8')
      res.on('data', (d) => b += d)
      res.on('end', () => resolve({ status: res.statusCode, body: b }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

;(async () => {
  try {
    console.log('Requesting signed URL from', BACKEND + '/api/upload-url')
    const resp = await postJson('/api/upload-url', { filename, contentType })
    console.log('Signed URL response status:', resp.status)
    const parsed = JSON.parse(resp.body || '{}')
    if (!parsed.signedUrl) {
      console.error('No signedUrl in response:', parsed)
      process.exitCode = 2
      return
    }
    console.log('Got signedUrl. Performing PUT...')
    const put = await putToSignedUrl(parsed.signedUrl, 'hello', contentType)
    console.log('PUT status:', put.status)
    console.log('PUT body:', put.body)
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err)
    process.exitCode = 2
  }
})()
