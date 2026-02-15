const express = require('express')
const router = express.Router()

router.get('/', (req, res) => {
  res.status(200).json({ pong: true })
})

router.post('/', (req, res) => {
  res.status(200).json({ pong: true })
})

module.exports = router
