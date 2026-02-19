"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = exports.runtime = void 0;
exports.POST = POST;
const server_1 = require("next/server");
const server_2 = require("@/lib/stripe/server");
const subscription_1 = require("@/lib/server/subscription");
exports.runtime = 'nodejs';
exports.dynamic = 'force-dynamic';
/**
 * POST /api/billing/checkout
 * Creates a Stripe Checkout Session for subscription purchase
 *
 * Body:
 *   - priceId: Stripe Price ID (e.g., price_1ABC...)
 *   - returnTo: URL to redirect after success (default: /editor)
 *
 * Returns:
 *   - { url: string } - Stripe Checkout Session URL
 */
async function POST(request) {
    try {
        // Validate Stripe configuration
        if (!(0, server_2.isStripeConfigured)()) {
            return server_1.NextResponse.json({ error: 'Stripe is not configured on the server' }, { status: 500 });
        }
        const stripe = (0, server_2.getStripe)();
        const body = await request.json();
        const { priceId, returnTo } = body;
        // Validate priceId
        if (!priceId || typeof priceId !== 'string' || !priceId.startsWith('price_')) {
            return server_1.NextResponse.json({ error: 'Invalid priceId. Must be a Stripe Price ID (starts with price_)' }, { status: 400 });
        }
        const userId = (0, subscription_1.getDemoUserId)();
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
        const returnPath = returnTo || '/editor';
        console.log('[checkout] Creating session:', { priceId, userId, returnPath });
        // Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            // Success URL includes session_id and returnTo parameter
            success_url: `${appUrl}/api/billing/success?session_id={CHECKOUT_SESSION_ID}&returnTo=${encodeURIComponent(returnPath)}`,
            cancel_url: `${appUrl}/pricing?canceled=1`,
            metadata: {
                userId,
                returnTo: returnPath,
            },
            client_reference_id: userId,
        });
        console.log('[checkout] Session created:', session.id);
        return server_1.NextResponse.json({ url: session.url });
    }
    catch (error) {
        console.error('[checkout] Error:', error);
        return server_1.NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
    }
}
