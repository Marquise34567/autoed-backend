// Minimal production-ready server entry (JavaScript)
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config() } catch (e) {}
}
const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok' }))
app.get('/', (_req, res) => res.json({ message: 'autoed-backend-ready' }))

const port = process.env.PORT || 5000
app.listen(port, () => {
  console.log('Server running on port', port)
})
