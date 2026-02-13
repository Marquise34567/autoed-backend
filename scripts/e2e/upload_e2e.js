const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001/editor'
const TEST_FILE = path.resolve(__dirname, 'test-video.mp4')

async function waitForServer(url, timeout = 30000) {
  const start = Date.now()
  const http = require('http')
  while (Date.now() - start < timeout) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, res => { res.resume(); resolve() })
        req.on('error', reject)
      })
      return
    } catch (e) {
      await new Promise(r => setTimeout(r, 500))
    }
  }
  throw new Error('Timeout waiting for server ' + url)
}

async function run() {
  if (!fs.existsSync(TEST_FILE)) {
    fs.writeFileSync(TEST_FILE, 'dummy video content')
  }

  console.log('Waiting for frontend to be available at', FRONTEND_URL)
  await waitForServer(FRONTEND_URL.replace(/\/editor$/, '/'))

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  page.on('console', msg => console.log('PAGE LOG:', msg.text()))
  page.on('pageerror', err => console.error('PAGE ERROR:', err.toString()))
  page.on('requestfailed', r => console.log('REQ FAILED', r.url(), r.failure && r.failure().errorText))
  page.on('requestfinished', r => console.log('REQ FINISHED', r.url(), r.response() && r.response().status()))
  page.setDefaultTimeout(60000)

  console.log('Opening editor page')
  await page.goto(FRONTEND_URL)

  // Wait for file input and upload button
  await page.waitForSelector('input[type=file]')
  const input = await page.$('input[type=file]')
  await input.uploadFile(TEST_FILE)

  // Click Upload button
  const [button] = await page.$x("//button[contains(., 'Upload')]")
  if (!button) throw new Error('Upload button not found')
  console.log('Clicking upload')
  await button.click()

  // Wait for status text to change to uploaded or error
  console.log('Waiting for upload result')
  await page.waitForFunction(() => {
    const el = document.querySelector('.text-sm')
    if (!el) return false
    const t = el.textContent || ''
    return t.toLowerCase().includes('uploaded') || t.toLowerCase().includes('error')
  }, { timeout: 120000 })

  const status = await page.evaluate(() => (document.querySelector('.text-sm') || {}).textContent)
  console.log('Upload status:', status)

  await browser.close()
}

run().then(() => { console.log('E2E script finished') }).catch(err => { console.error('E2E failed', err); process.exit(1) })
