"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = exports.runtime = void 0;
exports.POST = POST;
const server_1 = require("next/server");
const returnTo_1 = require("@/lib/client/returnTo");
const subscription_1 = require("@/lib/server/subscription");
const config_1 = require("@/lib/stripe/config");
const server_2 = require("@/lib/stripe/server");
exports.runtime = 'nodejs';
exports.dynamic = 'force-dynamic';
/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout Session for subscription.
 *
 * Request:
 * {
 *   plan: "starter" | "creator" | "studio"
 *   returnTo: "/editor" (internal path, validated)
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   url: "https://checkout.stripe.com/..." (Stripe checkout URL)
 * }
 */
async function POST(request) {
    try {
        if (!(0, server_2.isStripeConfigured)()) {
            return server_1.NextResponse.json({ ok: false, error: 'Stripe is not configured on the server' }, { status: 500 });
        }
        const stripe = (0, server_2.getStripe)();
        // CRITICAL SAFETY: Block checkout if billing is not live
        if (!(0, subscription_1.isBillingLive)()) {
            return server_1.NextResponse.json({
                ok: false,
                code: "BILLING_DISABLED",
                error: "Billing is not active yet. No charges will be made.",
            }, { status: 403 });
        }
        const body = await request.json();
        const { plan, returnTo } = body;
        // Validate inputs
        if (!plan || !['starter', 'creator', 'studio'].includes(plan)) {
            return server_1.NextResponse.json({ ok: false, error: 'Invalid plan. Must be starter, creator, or studio.' }, { status: 400 });
        }
        // Validate and sanitize returnTo
        const validatedReturnTo = (0, returnTo_1.validateReturnTo)(returnTo);
        // Get user ID (TODO: replace with real auth)
        const userId = (0, subscription_1.getDemoUserId)();
        // Get the price lookup key
        const priceLookup = config_1.STRIPE_PRICE_LOOKUPS[plan];
        if (!priceLookup) {
            return server_1.NextResponse.json({ ok: false, error: `No price configured for plan: ${plan}` }, { status: 500 });
        }
        // Build absolute URLs for Stripe redirects
        const appUrl = (0, config_1.getAppUrl)();
        const successUrl = `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}&returnTo=${encodeURIComponent(validatedReturnTo)}`;
        const cancelUrl = `${appUrl}/pricing?plan=${plan}&returnTo=${encodeURIComponent(validatedReturnTo)}`;
        console.log('[checkout] Creating Stripe session:', {
            plan,
            priceLookup,
            userId,
            returnTo: validatedReturnTo,
            successUrl,
            cancelUrl,
        });
        // Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `AutoEditor ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
                            description: `Monthly subscription to AutoEditor ${plan} plan`,
                        },
                        unit_amount: plan === 'starter' ? 900 : plan === 'creator' ? 2900 : 9900,
                        recurring: {
                            interval: 'month',
                        },
                    },
                    quantity: 1,
                },
            ],
            success_url: successUrl,
            cancel_url: cancelUrl,
            client_reference_id: userId,
            metadata: {
                userId,
                plan,
                returnTo: validatedReturnTo,
            },
            subscription_data: {
                metadata: {
                    userId,
                    plan,
                },
            },
        });
        console.log('[checkout] Stripe session created:', session.id);
        return server_1.NextResponse.json({
            ok: true,
            url: session.url,
            sessionId: session.id,
        }, { status: 200 });
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[checkout] Error:', errorMsg, error);
        return server_1.NextResponse.json({ ok: false, error: 'Failed to create checkout session', details: errorMsg }, { status: 500 });
    }
}
