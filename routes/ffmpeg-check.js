const express = require('express')
const router = express.Router()
const { exec } = require('child_process')

router.get('/', async (req, res) => {
  try {
    exec('ffmpeg -version', { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[ffmpeg-check] ffmpeg not available:', err && (err.message || err))
        return res.status(200).json({ ok: true, available: false, error: err && (err.message || String(err)) })
      }
      const firstLine = (stdout || '').split('\n')[0] || ''
      return res.status(200).json({ ok: true, available: true, version: firstLine.trim(), raw: stdout })
    })
  } catch (e) {
    console.error('[ffmpeg-check] unexpected error', e)
    return res.status(500).json({ ok: false, error: e && (e.message || String(e)) })
  }
})

module.exports = router
