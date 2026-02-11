import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import admin from '@/lib/firebaseAdmin'
import { STRIPE_PRICES, resolvePriceId } from '@/lib/stripePrices'

export const runtime = 'nodejs'

const stripeKey = process.env.STRIPE_SECRET_KEY || ''
const stripe = new Stripe(stripeKey || '', { apiVersion: '2024-06-20' })
const useMockStripe = !stripeKey || !stripeKey.startsWith('sk_')

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: Request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return jsonError('Missing STRIPE_SECRET_KEY', 500)
    if (!process.env.NEXT_PUBLIC_APP_URL && !process.env.APP_URL) return jsonError('Missing NEXT_PUBLIC_APP_URL or APP_URL', 500)

    const body = await req.json().catch(() => ({}))
    const { priceId, plan, interval, trialDays, trial } = body as { priceId?: string; plan?: string; interval?: string; trialDays?: number; trial?: boolean }

    let planKey: string | undefined = undefined

    // Authorization: Bearer <idToken>
    const authHeader = req.headers.get('authorization') || ''
    const match = authHeader.match(/^Bearer\s+(.+)$/i)
    if (!match) {
      return jsonError('Missing Authorization header', 401)
    }
    const idToken = match[1]

    // Verify Firebase ID token and get uid
    const firebaseAuth = admin.auth()
    let decoded: any

    // Test harness: allow bypassing auth when running tests by sending
    // header `x-bypass-auth: 1` and setting NODE_ENV=test. This keeps
    // production behavior unchanged while allowing Playwright to exercise
    // the checkout route without a real Firebase token.
    const bypassHeader = (req.headers.get('x-bypass-auth') || '') === '1'
    if (process.env.NODE_ENV === 'test' && bypassHeader) {
      decoded = { uid: 'test-uid', email: 'test@example.com' }
    } else {
      try {
        decoded = await firebaseAuth.verifyIdToken(idToken)
      } catch (err) {
        console.error('[checkout] Invalid Firebase ID token', err)
        return jsonError('Invalid ID token', 401)
      }
    }

    const uid = decoded.uid as string
    const email = decoded.email as string | undefined
    if (!uid) return jsonError('Invalid token: no uid', 401)

    // Resolve priceId either directly or from plan
    let resolvedPriceId: string | undefined = undefined
    if (priceId && typeof priceId === 'string') {
      if (!priceId.startsWith('price_')) return jsonError('Invalid priceId', 400)
      resolvedPriceId = priceId
    } else if (plan && typeof plan === 'string') {
      const rawPlan = plan
      const planAliasMap: Record<string, string> = { pro: 'creator', team: 'studio' }
      const planNormalized = (rawPlan || '').toString().trim().toLowerCase()
      const mappedPlan = planAliasMap[planNormalized] || planNormalized

      // normalize interval
      const rawInterval = interval || 'monthly'
      let intervalNormalized = (rawInterval || '').toString().trim().toLowerCase()
      if (intervalNormalized === 'month') intervalNormalized = 'monthly'
      if (intervalNormalized === 'year' || intervalNormalized === 'yearly' || intervalNormalized === 'yr') intervalNormalized = 'annual'
      if (intervalNormalized.startsWith('ann')) intervalNormalized = 'annual'
      if (!['monthly', 'annual'].includes(intervalNormalized)) intervalNormalized = 'monthly'

      planKey = mappedPlan

      const priceForPlan = STRIPE_PRICES[planKey] && STRIPE_PRICES[planKey][intervalNormalized as 'monthly' | 'annual']
      if (!priceForPlan) {
        const availablePlans = Object.keys(STRIPE_PRICES)
        const availForPlan = STRIPE_PRICES[planKey] ? Object.keys(STRIPE_PRICES[planKey]) : []
        return NextResponse.json({
          error: 'Price not configured for plan',
          received: { plan: rawPlan, interval: interval },
          normalized: { plan: planKey, interval: intervalNormalized },
          available: { plans: availablePlans, intervalsForNormalizedPlan: availForPlan },
        }, { status: 400 })
      }
      resolvedPriceId = priceForPlan
    } else {
      return jsonError('Missing priceId or plan', 400)
    }

    // Lookup user doc in Firestore
    const db = admin.firestore()
    const userRef = db.collection('users').doc(uid)
    const userSnap = await userRef.get()
    const userData = userSnap.exists ? userSnap.data() : {}

    let customerId = userData?.stripeCustomerId as string | undefined

    if (!customerId) {
      // Create Stripe customer
      const customer = await stripe.customers.create({
        email: email || undefined,
        metadata: { firebaseUid: uid },
      })
      customerId = customer.id
      await userRef.set({ stripeCustomerId: customerId }, { merge: true })
      console.log('[checkout] Created Stripe customer for uid', uid, customerId)
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || ''
    const successUrl = `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${appUrl}/pricing?canceled=1`

    // Build subscription_data
    const subscription_data: Record<string, any> = {
      metadata: { uid, plan: planKey ?? (plan ?? '') },
    }
    if (typeof trialDays === 'number' && trialDays > 0) {
      subscription_data.trial_period_days = trialDays
    } else if (trial) {
      subscription_data.trial_period_days = 7
    }

    if (useMockStripe) {
      const mockUrl = `${appUrl}/_mock_stripe_checkout?plan=${encodeURIComponent(planKey ?? '')}&interval=${encodeURIComponent(interval ?? 'monthly')}&price=${encodeURIComponent(resolvedPriceId ?? '')}&uid=${encodeURIComponent(uid)}`
      console.warn('[checkout] Using mock Stripe checkout (STRIPE_SECRET_KEY missing or not an sk_ key)')
      return NextResponse.json({ url: mockUrl })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: resolvedPriceId!, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { uid, plan: planKey ?? (plan ?? '') },
      subscription_data,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('[checkout] Error creating session', err)
    const msg = err instanceof Error ? err.message : 'Failed to create checkout session'
    return NextResponse.json({ error: msg, where: 'checkout' }, { status: 500 })
  }
}

