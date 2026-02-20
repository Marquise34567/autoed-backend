import express from 'express'
import bodyParser from 'body-parser'
import health from './routes/health'
import debug from './routes/debug'
import jobsRoutes from './jobs/jobs.routes'

export function createServer() {
  const app = express()
  app.use(bodyParser.json())
  app.use('/api', health)
  app.use('/api', debug)
  app.use('/api', jobsRoutes)
  // simple 404 JSON
  app.use((req, res) => res.status(404).json({ ok: false, error: 'not_found' }))
  return app
}
