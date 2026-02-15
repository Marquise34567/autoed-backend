// Global crash visibility BEFORE any imports
if (process.env.NODE_ENV !== 'production') {
  process.env.GRPC_TRACE = process.env.GRPC_TRACE || 'all'
  process.env.GRPC_VERBOSITY = process.env.GRPC_VERBOSITY || 'DEBUG'
}

process.on('unhandledRejection', (err) => {
  console.error('🚨 UNHANDLED REJECTION 🚨', err)
})

process.on('uncaughtException', (err) => {
  console.error('🚨 UNCAUGHT EXCEPTION 🚨', err)
})

// Minimal production-ready server entry (JavaScript)
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config() } catch (e) {}
}
const express = require('express')

// Boot log for entry file identification
console.log('✅ Booting backend entry:', __filename)

// Deploy marker to verify production has the latest code
const DEPLOY_MARKER = process.env.DEPLOY_MARKER || new Date().toISOString()
console.log('DEPLOY_MARKER=', DEPLOY_MARKER)

const app = express()

const cors = require('cors')

// Minimal CORS: allow all origins via the `cors` default for simplicity
// (Next.js proxy handles origin restrictions in production)
app.use(cors())

// Log CORS origin on every request for deploy verification
app.use((req, res, next) => {
  try {
    console.log('CORS Origin:', req.headers.origin || '<none>')
  } catch (e) {
    /* ignore logging errors */
  }
  next()
})

// CORS: use the standard `cors` middleware with a tight allowlist for the
// production frontend origins. This is mounted globally BEFORE any routes
// (including the webhook) so preflight and normal requests get consistent
// headers. Server-to-server (no Origin) requests are still allowed.

// Lightweight health endpoints
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' })
})

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' })
})

// Stripe + Firebase for webhook
const Stripe = require("stripe");

const stripeKey = process.env.STRIPE_SECRET_KEY;

let stripe = null;

if (stripeKey && stripeKey.startsWith("sk_")) {
  try {
    stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
    console.log("Stripe initialized");
  } catch (e) {
    console.warn("⚠️ Failed to initialize Stripe:", e);
    stripe = null;
  }
} else {
  console.warn("⚠️ STRIPE_SECRET_KEY missing/invalid — billing disabled.");
}

// Use a safe firebase admin initializer that tolerates missing/invalid envs
let admin = null
let bucket = null
try {
  // utils/firebaseAdmin will attempt to initialize admin only when valid creds are present
  admin = require('./utils/firebaseAdmin')
  try {
    const bn = process.env.FIREBASE_STORAGE_BUCKET || 'autoeditor-d4940.appspot.com'
    if (admin && typeof admin.getBucket === 'function') {
      try { bucket = admin.getBucket(bn) } catch (e) { bucket = null }
    }
    if (!bucket && admin && admin.storage) {
      try { bucket = admin.storage().bucket(bn) } catch (e) { bucket = null }
    }
    if (!bucket) console.warn('[startup] Firebase storage bucket not available (will error on upload attempts)')
  } catch (e) {
    console.warn('[startup] failed to resolve storage bucket', e && (e.stack || e.message || e))
  }
} catch (e) {
  // If utils module cannot be loaded, fall back to firebase-admin but do NOT initialize.
  console.warn('[startup] failed to load ./utils/firebaseAdmin, falling back to firebase-admin stub', e && (e.stack || e.message || e))
  try { admin = require('firebase-admin') } catch (er) { admin = null }
}

// Helper: cleanly log Firestore / gRPC errors with structured JSON
function logFirestoreError(err, context = {}) {
  try {
    const payload = {
      tag: 'FIRESTORE_ERROR',
      context: context || {},
      message: err && (err.message || String(err)),
      code: err && err.code,
      details: err && err.details,
      name: err && err.name,
      stack: err && err.stack,
    }
    const msg = String((err && err.message) || '')
    const m = msg.match(/^(\d+)\s+([A-Z_]+):/)
    if (m) {
      payload.grpc_status_number = Number(m[1])
      payload.grpc_status_name = m[2]
    }
    console.error(JSON.stringify(payload, null, 2))
  } catch (e) {
    console.error('[logFirestoreError] failed to stringify error', e, err)
  }
}

// async wrapper and auto-wrap Router to catch unhandled promise rejections
const wrapAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
try {
  const Router = express.Router
  const proto = Router && Router.prototype
  if (proto) {
    const methods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all', 'use']
    methods.forEach((m) => {
      const orig = proto[m]
      if (!orig) return
      proto[m] = function (...args) {
        const wrapped = args.map((a) => (typeof a === 'function' && a.length < 4 ? wrapAsync(a) : a))
        return orig.apply(this, wrapped)
      }
    })
  }
} catch (e) {
  console.warn('[startup] failed to patch Router for async safety', e && e.message ? e.message : e)
}

// Worker starter (starts loop when WORKER_ENABLED=true)
let worker = null
try {
  worker = require('./services/worker/worker')
} catch (e) {
  console.warn('[startup] worker module not available', e && (e.message || e))
}

// Temporary debug endpoint to verify Firebase initialization
app.get('/api/firebase-check', (req, res) => {
  try {
    const apps = admin && Array.isArray(admin.apps) ? admin.apps.length : 0
    if (apps && apps > 0) return res.json({ ok: true, apps })
    if (!admin) return res.status(503).json({ ok: false, error: 'Firebase not configured' })
    return res.json({ ok: false, error: 'Firebase not initialized' })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) })
  }
})

// Debug endpoint to surface Firestore errors clearly
app.get('/api/debug/firestore', wrapAsync(async (req, res) => {
  try {
    if (!db) return res.status(503).json({ ok: false, error: 'Firestore not configured' })
    const snap = await db.collection('jobs').limit(1).get()
    return res.json({ ok: true, size: snap.size })
  } catch (err) {
    logFirestoreError(err, { where: 'GET /api/debug/firestore', op: 'jobs.limit(1).get' })
    return res.status(500).json({ ok: false, message: err?.message, code: err?.code })
  }
}))

// Debug: queued jobs count and Firestore info
app.get('/api/debug/jobs/queued-count', wrapAsync(async (req, res) => {
  try {
    if (!db) return res.status(503).json({ ok: false, error: 'Firestore not configured' })
    const proj = (admin && admin.options && admin.options.credential && admin.options.credential.projectId) || process.env.FIREBASE_PROJECT_ID || '<unknown>'
    console.log('[debug] reading Firestore project:', proj, 'collection=jobs')
    const q = await db.collection('jobs').where('status', '==', 'queued').get()
    const cnt = q && typeof q.size === 'number' ? q.size : (q && q.docs ? q.docs.length : 0)
    return res.json({ queuedCount: cnt })
  } catch (err) {
    console.error('[debug] /api/debug/jobs/queued-count error', err && (err.stack || err.message || err))
    return res.status(500).json({ ok: false, error: err && err.message })
  }
}))

// IMPORTANT: Do not register global `express.json()` before the webhook route
// The webhook requires the raw request body for signature verification.
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature']
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET not configured')
    return res.status(500).json({ error: 'Webhook secret not configured' })
  }

  let event
  try {
    if (!stripe) {
      console.error('[webhook] Stripe not configured')
      return res.status(503).json({ ok: false, error: 'Billing not configured' })
    }
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret)
  } catch (err) {
    console.error('[webhook] Invalid signature', err)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  const db = admin.firestore()
  try {
    // Idempotency: skip if processed
    if (event && event.id) {
      const evtRef = db.collection('stripe_events').doc(event.id)
      const snap = await evtRef.get()
      if (snap.exists) {
        console.log('[webhook] duplicate event, already processed', event.id)
        return res.json({ received: true })
      }
      await evtRef.set({ createdAt: admin.firestore.FieldValue.serverTimestamp(), type: event.type }, { merge: true })
    }

    // Handle relevant Stripe events
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const userId = (session.metadata && (session.metadata.userId || session.metadata.uid)) || undefined
        if (!userId) {
          console.warn('[webhook] checkout.session.completed missing userId in metadata')
        } else {
          try {
            await db.collection('users').doc(userId).set({
              subscriptionStatus: 'active',
              stripeCustomerId: session.customer || undefined,
              stripeSubscriptionId: session.subscription || undefined,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true })
          } catch (err) {
            console.error('🔥 FIRESTORE FAILURE DETECTED 🔥')
            console.error('Message:', err && err.message ? err.message : err)
            console.error('Code:', err && err.code ? err.code : undefined)
            console.error('Details:', err && err.details ? err.details : undefined)
            console.error('Metadata:', err && err.metadata ? err.metadata : undefined)
            try {
              console.error('Full Error Object:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2))
            } catch (e) {
              console.error('Full Error Object (stringify failed):', err)
            }
            throw err
          }
        }
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object
        const uidFromMeta = sub.metadata && (sub.metadata.uid || sub.metadata.userId)
        let userRef = null

        if (uidFromMeta) {
          userRef = db.collection('users').doc(uidFromMeta)
        } else if (typeof sub.customer === 'string') {
          try {
            const q = await db.collection('users').where('stripeCustomerId', '==', sub.customer).limit(1).get()
            if (!q.empty) userRef = q.docs[0].ref
          } catch (err) {
            console.error('🔥 FIRESTORE FAILURE DETECTED 🔥')
            console.error('Message:', err && err.message ? err.message : err)
            console.error('Code:', err && err.code ? err.code : undefined)
            console.error('Details:', err && err.details ? err.details : undefined)
            console.error('Metadata:', err && err.metadata ? err.metadata : undefined)
            try {
              console.error('Full Error Object:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2))
            } catch (e) {
              console.error('Full Error Object (stringify failed):', err)
            }
            throw err
          }
        }

        if (!userRef) {
          console.warn('[webhook] subscription event but no user found for subscription', sub.id)
        } else {
          const plan = (sub.metadata && sub.metadata.plan) || null
          const status = sub.status
          const currentPeriodEnd = sub.current_period_end ? sub.current_period_end * 1000 : null
          try {
            await userRef.set({
              stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : undefined,
              plan,
              subscriptionStatus: status,
              currentPeriodEnd,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              stripeSubscriptionId: sub.id,
            }, { merge: true })
            console.log('[webhook] subscription.updated -> user updated', userRef.id, { plan, status })
          } catch (err) {
            console.error('🔥 FIRESTORE FAILURE DETECTED 🔥')
            console.error('Message:', err && err.message ? err.message : err)
            console.error('Code:', err && err.code ? err.code : undefined)
            console.error('Details:', err && err.details ? err.details : undefined)
            console.error('Metadata:', err && err.metadata ? err.metadata : undefined)
            try {
              console.error('Full Error Object:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2))
            } catch (e) {
              console.error('Full Error Object (stringify failed):', err)
            }
            throw err
          }
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object
        try {
          const q = await db.collection('users').where('stripeSubscriptionId', '==', sub.id).limit(1).get()
          if (q.empty) {
            console.warn('[webhook] subscription.deleted but no user found for', sub.id)
          } else {
            const ref = q.docs[0].ref
            await ref.set({
              plan: 'free',
              subscriptionStatus: 'canceled',
              currentPeriodEnd: null,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true })
            console.log('[webhook] subscription.deleted -> set user to free', ref.id)
          }
        } catch (err) {
          console.error('🔥 FIRESTORE FAILURE DETECTED 🔥')
          console.error('Message:', err && err.message ? err.message : err)
          console.error('Code:', err && err.code ? err.code : undefined)
          console.error('Details:', err && err.details ? err.details : undefined)
          console.error('Metadata:', err && err.metadata ? err.metadata : undefined)
          try {
            console.error('Full Error Object:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2))
          } catch (e) {
            console.error('Full Error Object (stringify failed):', err)
          }
          throw err
        }
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object
        const subId = invoice.subscription
        if (subId) {
          try {
            const q = await db.collection('users').where('stripeSubscriptionId', '==', subId).limit(1).get()
            if (!q.empty) {
              const ref = q.docs[0].ref
              await ref.set({
                subscriptionStatus: 'active',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              }, { merge: true })
              console.log('[webhook] invoice.payment_succeeded -> marked active', ref.id)
            }
          } catch (err) {
            console.error('🔥 FIRESTORE FAILURE DETECTED 🔥')
            console.error('Message:', err && err.message ? err.message : err)
            console.error('Code:', err && err.code ? err.code : undefined)
            console.error('Details:', err && err.details ? err.details : undefined)
            console.error('Metadata:', err && err.metadata ? err.metadata : undefined)
            try {
              console.error('Full Error Object:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2))
            } catch (e) {
              console.error('Full Error Object (stringify failed):', err)
            }
            throw err
          }
        }
        break
      }

      default:
        console.log('[webhook] unhandled event', event.type)
    }

    // mark processed
    try {
      if (event && event.id) {
        await db.collection('stripe_events').doc(event.id).set({ processed: true, processedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
      }
    } catch (e) {
      console.warn('[webhook] failed to mark event processed', e)
    }

    return res.json({ received: true })
  } catch (err) {
    console.error('🔥 FIRESTORE / WEBHOOK PROCESSING ERROR 🔥')
    console.error('Message:', err && err.message ? err.message : err)
    console.error('Code:', err && err.code ? err.code : undefined)
    console.error('Details:', err && err.details ? err.details : undefined)
    console.error('Metadata:', err && err.metadata ? err.metadata : undefined)
    console.error('Stack:', err && err.stack ? err.stack : undefined)
    try {
      console.error('Full Error Object:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2))
    } catch (e) {
      console.error('Full Error Object (stringify failed):', err)
    }
    return res.status(500).json({ error: 'Webhook processing failed' })
  }
})

// Ensure JSON and urlencoded parsers are registered BEFORE any route mounts
// so API routes receive parsed bodies (webhook above still uses raw).
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
// Logging middleware: log incoming requests and final status for diagnosis
app.use((req, res, next) => {
  const start = Date.now()
  const origin = req.headers.origin || '<no-origin>'
  console.log(`[req] ${req.method} ${req.path} origin=${origin}`)
  res.on('finish', () => {
    const ms = Date.now() - start
    console.log(`[res] ${req.method} ${req.path} origin=${origin} status=${res.statusCode} time=${ms}ms`)
  })
  next()
})

// (CORS already configured at top of file)

// JSON parse error handler: return JSON for malformed JSON bodies
// Place directly after the json parser so body-parser errors are handled
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && (err instanceof SyntaxError || err.type === 'entity.parse.failed')) {
    if (req.path && req.path.startsWith('/api/')) {
      return res.status(400).json({ ok: false, error: 'Invalid JSON' })
    }
    return res.status(400).send('Invalid JSON')
  }
  return next(err)
})

// Standard health + root endpoints under /api
app.get('/api/health', (_req, res) => {
  return res.json({ ok: true, deployMarker: DEPLOY_MARKER, time: new Date().toISOString() })
})
app.get('/', (_req, res) => res.json({ message: 'autoed-backend-ready' }))

// Diagnostic: deployment marker to confirm which code is running in production
app.get('/__deploy', (_req, res) => {
  return res.json({ ok: true, deploy: DEPLOY_MARKER })
})

// Minimal fallbacks so endpoints respond even if route modules aren't mounted in the image
app.get('/api/ping', (_req, res) => res.json({ pong: true }))
app.get('/api/userdoc', (_req, res) => res.json({ ok: true }))
// Minimal fallbacks so endpoints respond even if route modules aren't mounted in the image
// (More specific POST /api/upload-url fallback moved below so mounted router is used first.)

// Mount existing route folders under /api when possible (non-fatal if module isn't an Express router)
// Mount explicit routers under /api
app.use('/api/health', require('./routes/health'))
app.use('/api/ping', require('./routes/ping'))
app.use("/api/jobs", require("./routes/jobs"))
// Also mount non-/api path for backward compatibility (frontend may call /jobs)
app.use("/jobs", require("./routes/jobs"))
app.use('/api/job-status', require('./routes/job-status'))
app.use('/api/userdoc', require('./routes/userdoc'))
// Upload endpoint: accepts multipart/form-data and uploads to Firebase Storage
try {
  app.use('/api/upload', require('./routes/upload'))
} catch (e) {
  console.warn('[routes] failed to mount /api/upload', e && e.message ? e.message : e)
}
try {
  // Mount inline signed-upload URL generator
} catch (e) {
  console.warn('[routes] failed to mount /api/upload', e && e.message ? e.message : e)
}

// Signed upload URL endpoint (direct-to-storage)
app.post('/api/upload-url', async (req, res) => {
  try {
    const body = req.body || {}
    const fileName = body.fileName || body.filename || body.file_name || null
    const contentType = body.contentType || body.content_type || body.contenttype || null

    console.log('[upload-url] request body keys:', Object.keys(body))

    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required' })
    }

    // Temporary debug: surface key values for troubleshooting
    try {
      console.log('[upload-url] Bucket:', bucket && (bucket.name || bucket.id || '<unknown>'))
      console.log('[upload-url] Filename:', fileName)
      console.log('[upload-url] ContentType:', contentType)
    } catch (e) {
      console.warn('[upload-url] failed to log debug values', e)
    }

    const storagePath = `uploads/${Date.now()}-${fileName}`

    const file = bucket.file(storagePath)

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: new Date(Date.now() + 15 * 60 * 1000),
      contentType
    })

    console.log('[upload-url] generated:', storagePath)

    return res.json({
      uploadUrl,
      storagePath
    })

  } catch (error) {
    console.error('[upload-url] ERROR:', error && (error.stack || error.message || error))
    return res.status(500).json({ error: 'Failed to generate signed URL', details: error && error.message })
  }
})
try { console.log('Mounted /api/upload') } catch (e) {}
// Signed-upload endpoints removed to enforce client-side Firebase SDK uploads.
// Debug routes removed (signed URL debug endpoints disabled)

// Lightweight ffmpeg availability check (useful to verify Railway runtime)
try {
  app.use('/api/ffmpeg-check', require('./routes/ffmpeg-check'))
} catch (e) {
  console.warn('[ffmpeg-check] failed to mount ffmpeg-check route', e && e.message ? e.message : e)
}

// Confirm mounted routes for easier production debugging
try {
  console.log('Mounted /api/jobs')
} catch (e) {
  console.warn('Failed to log mounted /api/jobs', e && e.message ? e.message : e)
}

// Ensure a minimal /api/jobs GET exists so frontends don't get 404.
// If a router was mounted above it will handle requests; this is a safe fallback.
app.get('/api/jobs', (req, res) => {
  res.status(200).json({ ok: true, jobs: [] })
})

// Top-level POST fallback for /api/upload-url to guard against missing mounted router
// This runs after mounts, so if the mounted router exists it will handle the POST.
// Signed-upload endpoints removed to enforce client-side Firebase SDK uploads.

// Return JSON for missing API routes instead of HTML
app.use((req, res, next) => {
  if (req.path && req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'Not found', path: req.originalUrl })
  }
  return next()
})

// Generic error handler that returns JSON for API routes
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  try {
    if (err && (String(err && err.message || '').toLowerCase().includes('firestore') || err && err.code)) {
      logFirestoreError(err, { where: 'GLOBAL_HANDLER', route: req.originalUrl, method: req.method })
    } else {
      console.error('[error] ', err && (err.stack || err.message || err))
    }
  } catch (e) {
    console.error('[error] failed logging error', e)
  }
  if (req.path && req.path.startsWith('/api/')) {
    const status = err && err.status ? err.status : 500
    return res.status(status).json({ ok: false, error: err && err.message ? err.message : 'Server error' })
  }
  return next(err)
})

// Log all registered routes to help debugging and deployments
function logRegisteredRoutes() {
  try {
    const routes = []
    const stack = (app._router && app._router.stack) || []
    stack.forEach((layer) => {
      if (layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods).join(',').toUpperCase()
        routes.push(`${methods} ${layer.route.path}`)
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        layer.handle.stack.forEach((nested) => {
          if (nested.route && nested.route.path) {
            const methods = Object.keys(nested.route.methods).join(',').toUpperCase()
            routes.push(`${methods} ${nested.route.path}`)
          }
        })
      }
    })
    console.log('[routes] Registered routes:\n' + routes.join('\n'))
  } catch (e) {
    console.warn('[routes] Failed to enumerate routes', e)
  }
}

// Log route readiness for quick verification
console.log('✅ Routes ready: /api/health, /api/jobs')

// Bind to the PORT environment variable (Railway sets this) or fallback for local dev
const PORT = process.env.PORT || 8080
app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ Listening on', PORT)
  logRegisteredRoutes()
  try {
    if (worker && typeof worker.start === 'function') {
      worker.start()
      console.log('[worker] start invoked from index.js')
    }
  } catch (e) {
    console.error('[startup] failed to start worker', e && (e.stack || e.message || e))
  }
})
// Start worker loop if enabled via env
try {
  const workerEnabled = String(process.env.WORKER_ENABLED || 'false').toLowerCase() === 'true'
  if (workerEnabled) {
    try {
      const worker = require('./services/worker/worker')
      worker.start()
      console.log('[worker] worker.start() invoked')
    } catch (e) {
      console.warn('[worker] failed to start worker', e && e.message ? e.message : e)
    }
  } else {
    console.log('[worker] WORKER_ENABLED not true; worker not started')
  }
} catch (e) {
  console.warn('[worker] worker startup check failed', e && e.message ? e.message : e)
}
