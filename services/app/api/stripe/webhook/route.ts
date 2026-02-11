import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import admin from '@/lib/firebaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' })

/**
 * Stripe webhook handler — verifies signature and updates Firestore users doc.
 */
export async function POST(req: NextRequest) {
	const buf = await req.arrayBuffer()
	const signature = req.headers.get('stripe-signature') || ''
	const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

	if (!webhookSecret) {
		console.error('[webhook] STRIPE_WEBHOOK_SECRET not configured')
		return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
	}

	let event: Stripe.Event
	try {
		event = stripe.webhooks.constructEvent(Buffer.from(buf), signature, webhookSecret)
	} catch (err) {
		console.error('[webhook] Invalid signature', err)
		return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
	}

	const db = admin.firestore()

	try {
		switch (event.type) {
			case 'checkout.session.completed': {
				const session = event.data.object as Stripe.Checkout.Session
				const uid = (session.metadata as any)?.uid as string | undefined
				if (!uid) {
					console.warn('[webhook] checkout.session.completed without uid metadata')
					break
				}

				if (!session.subscription) {
					console.warn('[webhook] checkout.session.completed without subscription id')
					break
				}

				const sub = await stripe.subscriptions.retrieve(session.subscription as string)
				const status = sub.status
				const plan = (sub.metadata?.plan as string) || (session.metadata?.plan as string) || null
				const currentPeriodEnd = sub.current_period_end ? sub.current_period_end * 1000 : null

				await db.collection('users').doc(uid).set({
					stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : undefined,
					plan,
					status,
					currentPeriodEnd,
					updatedAt: admin.firestore.FieldValue.serverTimestamp(),
					stripeSubscriptionId: sub.id,
				}, { merge: true })

				console.log('[webhook] checkout.session.completed -> updated user', uid, { plan, status })
				break
			}

			case 'customer.subscription.created':
			case 'customer.subscription.updated': {
				const sub = event.data.object as Stripe.Subscription
				const uidFromMeta = sub.metadata?.uid as string | undefined
				let userRef = null

				if (uidFromMeta) {
					userRef = db.collection('users').doc(uidFromMeta)
				} else if (typeof sub.customer === 'string') {
					// lookup by stripeCustomerId
					const q = await db.collection('users').where('stripeCustomerId', '==', sub.customer as string).limit(1).get()
					if (!q.empty) userRef = q.docs[0].ref
				}

				if (!userRef) {
					console.warn('[webhook] subscription event but no user found for subscription', sub.id)
					break
				}

				const plan = (sub.metadata?.plan as string) || null
				const status = sub.status
				const currentPeriodEnd = sub.current_period_end ? sub.current_period_end * 1000 : null

				await userRef.set({
					stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : undefined,
					plan,
					status,
					currentPeriodEnd,
					updatedAt: admin.firestore.FieldValue.serverTimestamp(),
					stripeSubscriptionId: sub.id,
				}, { merge: true })

				console.log('[webhook] subscription.updated -> user updated', userRef.id, { plan, status })
				break
			}

			case 'customer.subscription.deleted': {
				const sub = event.data.object as Stripe.Subscription
				// find user by subscription id
				const q = await db.collection('users').where('stripeSubscriptionId', '==', sub.id).limit(1).get()
				if (q.empty) {
					console.warn('[webhook] subscription.deleted but no user found for', sub.id)
					break
				}
				const ref = q.docs[0].ref
				await ref.set({
					plan: 'free',
					status: 'canceled',
					currentPeriodEnd: null,
					updatedAt: admin.firestore.FieldValue.serverTimestamp(),
				}, { merge: true })
				console.log('[webhook] subscription.deleted -> set user to free', ref.id)
				break
			}

			default:
				console.log('[webhook] unhandled event', event.type)
		}

		return NextResponse.json({ received: true })
	} catch (err) {
		console.error('[webhook] processing error', err)
		return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
	}
}



