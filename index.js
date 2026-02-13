// Minimal production-ready server entry (JavaScript)
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config() } catch (e) {}
}
const express = require('express')

// Boot log for entry file identification
console.log('✅ Booting backend entry:', __filename)

const app = express()

// Guaranteed CORS middleware: dynamically echo origin and allow credentials
// Placed before any routes so CORS headers are always set for browser requests.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  const reqHeaders = req.headers["access-control-request-headers"];
  res.setHeader("Access-Control-Allow-Headers", reqHeaders || "Content-Type, Authorization, X-Requested-With");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

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

const admin = require('./utils/firebaseAdmin')

// Temporary debug endpoint to verify Firebase initialization
app.get('/api/firebase-check', (req, res) => {
  try {
    const apps = Array.isArray(admin.apps) ? admin.apps.length : 0
    if (apps && apps > 0) return res.json({ ok: true, apps })
    return res.json({ ok: false, error: 'Firebase not initialized' })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) })
  }
})

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
          await db.collection('users').doc(userId).set({
            subscriptionStatus: 'active',
            stripeCustomerId: session.customer || undefined,
            stripeSubscriptionId: session.subscription || undefined,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true })
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
          const q = await db.collection('users').where('stripeCustomerId', '==', sub.customer).limit(1).get()
          if (!q.empty) userRef = q.docs[0].ref
        }

        if (!userRef) {
          console.warn('[webhook] subscription event but no user found for subscription', sub.id)
        } else {
          const plan = (sub.metadata && sub.metadata.plan) || null
          const status = sub.status
          const currentPeriodEnd = sub.current_period_end ? sub.current_period_end * 1000 : null
          await userRef.set({
            stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : undefined,
            plan,
            subscriptionStatus: status,
            currentPeriodEnd,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            stripeSubscriptionId: sub.id,
          }, { merge: true })
          console.log('[webhook] subscription.updated -> user updated', userRef.id, { plan, status })
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object
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
        break
      }

      case 'invoice.payment_succeeded': {
        // Optional: use invoice to mark active if needed
        const invoice = event.data.object
        const subId = invoice.subscription
        if (subId) {
          const q = await db.collection('users').where('stripeSubscriptionId', '==', subId).limit(1).get()
          if (!q.empty) {
            const ref = q.docs[0].ref
            await ref.set({
              subscriptionStatus: 'active',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true })
            console.log('[webhook] invoice.payment_succeeded -> marked active', ref.id)
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
    console.error('[webhook] processing error', err)
    return res.status(500).json({ error: 'Webhook processing failed' })
  }
})

// Ensure JSON and urlencoded parsers are registered BEFORE any route mounts
// so API routes receive parsed bodies (webhook above still uses raw).
app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ extended: true }))

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
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
app.get('/', (_req, res) => res.json({ message: 'autoed-backend-ready' }))

// Minimal fallbacks so endpoints respond even if route modules aren't mounted in the image
app.get('/api/ping', (_req, res) => res.json({ pong: true }))
app.get('/api/userdoc', (_req, res) => res.json({ ok: true }))
// Minimal fallbacks so endpoints respond even if route modules aren't mounted in the image
// (More specific POST /api/upload-url fallback moved below so mounted router is used first.)

// Mount existing route folders under /api when possible (non-fatal if module isn't an Express router)
// Mount explicit routers under /api
app.use('/api/health', require('./routes/health'))
app.use('/api/ping', require('./routes/ping'))
app.use('/api/jobs', require('./routes/jobs'))
app.use('/api/job-status', require('./routes/job-status'))
app.use('/api/userdoc', require('./routes/userdoc'))
app.use('/api/upload-url', require('./routes/upload-url'))

// Ensure a minimal /api/jobs GET exists so frontends don't get 404.
// If a router was mounted above it will handle requests; this is a safe fallback.
app.get('/api/jobs', (req, res) => {
  res.status(200).json({ ok: true, jobs: [] })
})

// Top-level POST fallback for /api/upload-url to guard against missing mounted router
// This runs after mounts, so if the mounted router exists it will handle the POST.
app.post('/api/upload-url', (req, res) => {
  ;(async () => {
    try {
      const { filename, contentType, mime } = req.body || {}
      const ct = contentType || mime || null
      if (!filename || !ct) return res.status(400).json({ ok: false, error: 'Missing filename or contentType' })

      let adminFallback = null
      try {
        adminFallback = require('./utils/firebaseAdmin')
      } catch (e) {
        adminFallback = null
      }

      if (!adminFallback || !adminFallback.storage) {
        return res.status(500).json({ ok: false, error: 'Firebase admin not configured' })
      }

      try {
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET || undefined
        const bucket = bucketName ? adminFallback.storage().bucket(bucketName) : adminFallback.storage().bucket()
        const safeFilename = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_')
        const destPath = `uploads/${Date.now()}-${safeFilename}`
        const file = bucket.file(destPath)
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

        const [signedUrl] = await file.getSignedUrl({ version: 'v4', action: 'write', expires: expiresAt, contentType: ct })
        console.log('[upload-url fallback] signedUrl generated:', !!signedUrl, { path: destPath, bucket: bucket.name })
        if (!signedUrl || typeof signedUrl !== 'string') {
          console.error('[upload-url fallback] signedUrl is invalid', { path: destPath, bucket: bucket.name, contentType: ct })
          return res.status(500).json({ error: 'SIGNED_URL_FAILED', details: 'signedUrl undefined' })
        }
        return res.status(200).json({ signedUrl, path: destPath, publicUrl: null })
      } catch (err) {
        console.error('[upload-url fallback] firebase error:', err && (err.message || err))
        return res.status(500).json({ ok: false, error: 'Failed to generate signed URL', details: err && err.message ? err.message : String(err) })
      }
    } catch (err) {
      console.error('[upload-url fallback] handler error', err && (err.stack || err.message || err))
      return res.status(500).json({ ok: false, error: 'Internal server error', details: err && err.message ? err.message : String(err) })
    }
  })()
})

// Return JSON for missing API routes instead of HTML
app.use((req, res, next) => {
  if (req.path && req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'Not found' })
  }
  return next()
})

// Generic error handler that returns JSON for API routes
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error] ', err && (err.stack || err.message || err))
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
})
