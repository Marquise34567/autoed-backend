const puppeteer = require('puppeteer')

const BACKEND = process.env.BACKEND_URL || 'https://remarkable-comfort-production-4a9a.up.railway.app'

async function run() {
  console.log('Using backend:', BACKEND)
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  page.on('console', msg => console.log('PAGE:', msg.text()))
  page.on('pageerror', err => console.error('PAGE ERR:', err.toString()))

  // Minimal client-side uploader executed in the page context
  await page.evaluateOnNewDocument(() => {
    window.addEventListener('error', e => console.error('window error', e))
  })

  // Navigate to the production frontend root so the page origin matches the
  // allowed origins configured on the backend (https://www.autoeditor.app).
  await page.goto('https://www.autoeditor.app/')

  const result = await page.evaluate(async (backend) => {
    try {
      const body = { filename: 'e2e-browser-test.txt', contentType: 'text/plain' }
      console.log('Requesting signed URL from', backend + '/api/upload-url')
      const tokenResp = await fetch(backend + '/api/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
      if (!tokenResp.ok) {
        const txt = await tokenResp.text()
        return { ok: false, stage: 'get-signed-url', status: tokenResp.status, text: txt }
      }
      const json = await tokenResp.json()
      if (!json.signedUrl) return { ok: false, stage: 'no-signed-url', body: json }
      const url = json.signedUrl
      console.log('Got signed URL, performing browser PUT to GCS')
      const putResp = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'hello-from-e2e', mode: 'cors', credentials: 'omit' })
      const putText = await (putResp.text().catch(() => ''))
      return { ok: putResp.ok, stage: 'put', status: putResp.status, text: putText }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }, BACKEND)

  console.log('Browser test result:', result)
  await browser.close()
  if (!result.ok) process.exit(1)
}

run().catch(err => { console.error('E2E test error', err); process.exit(1) })
