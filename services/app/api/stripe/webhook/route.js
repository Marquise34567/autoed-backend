"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = exports.runtime = void 0;
exports.POST = POST;
const server_1 = require("next/server");
const firebaseAdmin_1 = __importDefault(require("@/lib/firebaseAdmin"));
const server_2 = require("@/lib/stripe/server");
exports.runtime = 'nodejs';
exports.dynamic = 'force-dynamic';
// stripe may be null if STRIPE_SECRET_KEY is not configured
/**
 * Stripe webhook handler — verifies signature and updates Firestore users doc.
 */
async function POST(req) {
    const buf = await req.arrayBuffer();
    const signature = req.headers.get('stripe-signature') || '';
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        console.error('[webhook] STRIPE_WEBHOOK_SECRET not configured');
        return server_1.NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }
    let event;
    try {
        if (!server_2.stripe) {
            console.error('[webhook] Stripe not configured');
            return server_1.NextResponse.json({ ok: false, error: 'Billing not configured' }, { status: 503 });
        }
        event = server_2.stripe.webhooks.constructEvent(Buffer.from(buf), signature, webhookSecret);
    }
    catch (err) {
        console.error('[webhook] Invalid signature', err);
        return server_1.NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
    const db = firebaseAdmin_1.default.firestore();
    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const uid = session.metadata?.uid;
                if (!uid) {
                    console.warn('[webhook] checkout.session.completed without uid metadata');
                    break;
                }
                if (!session.subscription) {
                    console.warn('[webhook] checkout.session.completed without subscription id');
                    break;
                }
                const sub = await server_2.stripe.subscriptions.retrieve(session.subscription);
                const status = sub.status;
                const plan = sub.metadata?.plan || session.metadata?.plan || null;
                const currentPeriodEnd = sub.current_period_end ? sub.current_period_end * 1000 : null;
                await db.collection('users').doc(uid).set({
                    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : undefined,
                    plan,
                    status,
                    currentPeriodEnd,
                    updatedAt: firebaseAdmin_1.default.firestore.FieldValue.serverTimestamp(),
                    stripeSubscriptionId: sub.id,
                }, { merge: true });
                console.log('[webhook] checkout.session.completed -> updated user', uid, { plan, status });
                break;
            }
            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const sub = event.data.object;
                const uidFromMeta = sub.metadata?.uid;
                let userRef = null;
                if (uidFromMeta) {
                    userRef = db.collection('users').doc(uidFromMeta);
                }
                else if (typeof sub.customer === 'string') {
                    // lookup by stripeCustomerId
                    const q = await db.collection('users').where('stripeCustomerId', '==', sub.customer).limit(1).get();
                    if (!q.empty)
                        userRef = q.docs[0].ref;
                }
                if (!userRef) {
                    console.warn('[webhook] subscription event but no user found for subscription', sub.id);
                    break;
                }
                const plan = sub.metadata?.plan || null;
                const status = sub.status;
                const currentPeriodEnd = sub.current_period_end ? sub.current_period_end * 1000 : null;
                await userRef.set({
                    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : undefined,
                    plan,
                    status,
                    currentPeriodEnd,
                    updatedAt: firebaseAdmin_1.default.firestore.FieldValue.serverTimestamp(),
                    stripeSubscriptionId: sub.id,
                }, { merge: true });
                console.log('[webhook] subscription.updated -> user updated', userRef.id, { plan, status });
                break;
            }
            case 'customer.subscription.deleted': {
                const sub = event.data.object;
                // find user by subscription id
                const q = await db.collection('users').where('stripeSubscriptionId', '==', sub.id).limit(1).get();
                if (q.empty) {
                    console.warn('[webhook] subscription.deleted but no user found for', sub.id);
                    break;
                }
                const ref = q.docs[0].ref;
                await ref.set({
                    plan: 'free',
                    status: 'canceled',
                    currentPeriodEnd: null,
                    updatedAt: firebaseAdmin_1.default.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
                console.log('[webhook] subscription.deleted -> set user to free', ref.id);
                break;
            }
            default:
                console.log('[webhook] unhandled event', event.type);
        }
        return server_1.NextResponse.json({ received: true });
    }
    catch (err) {
        console.error('[webhook] processing error', err);
        return server_1.NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
    }
}
