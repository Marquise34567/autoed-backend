// Minimal production-ready server entry (JavaScript)
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config() } catch (e) {}
}
const express = require('express')
const cors = require('cors')

const app = express()
// Allow only the frontend origin when provided, otherwise allow all for local dev
const frontendUrl = process.env.FRONTEND_URL || ''
app.use(cors(frontendUrl ? { origin: frontendUrl } : {}))

// Stripe + Firebase for webhook
const Stripe = require('stripe')
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '')
const admin = require('./utils/firebaseAdmin')

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

// Now register body parser for all other routes
app.use(express.json({ limit: '10mb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok' }))
app.get('/', (_req, res) => res.json({ message: 'autoed-backend-ready' }))

// Bind to the PORT environment variable (Railway sets this) or fallback for local dev
const port = process.env.PORT || 5000
app.listen(port, () => {
  console.log('Server running on port', port)
})
