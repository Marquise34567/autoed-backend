const express = require('express')
const router = express.Router()

const admin = require('../utils/firebaseAdmin')
const bucket = (admin && admin.storage) ? admin.storage().bucket('autoeditor-d4940.firebasestorage.app') : (require('../utils/firebaseAdmin').getBucket && require('../utils/firebaseAdmin').getBucket())

router.post('/', async (req, res) => {
  try {
    const { filename } = req.body || {}

    if (!filename) {
      return res.status(400).json({ error: 'Filename required' })
    }

    const file = bucket.file(`uploads/${Date.now()}-${filename}`)

    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000,
      contentType: 'application/octet-stream',
    })

    return res.status(200).json({
      uploadUrl: url,
      path: file.name,
    })
  } catch (error) {
    console.error('Signed URL error:', error)
    return res.status(500).json({ error: error && error.message ? error.message : String(error) })
  }
})

module.exports = router
