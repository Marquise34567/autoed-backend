"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.POST = POST;
const server_1 = require("next/server");
const firebaseAdmin_1 = __importDefault(require("@/lib/firebaseAdmin"));
const stripePrices_1 = require("@/lib/stripePrices");
const server_2 = require("@/lib/stripe/server");
exports.runtime = 'nodejs';
const stripeKey = process.env.STRIPE_SECRET_KEY || '';
const useMockStripe = !stripeKey || !stripeKey.startsWith('sk_');
function jsonError(message, status = 400) {
    return server_1.NextResponse.json({ error: message }, { status });
}
async function POST(req) {
    try {
        if (!process.env.STRIPE_SECRET_KEY)
            return jsonError('Missing STRIPE_SECRET_KEY', 500);
        if (!process.env.NEXT_PUBLIC_APP_URL && !process.env.APP_URL)
            return jsonError('Missing NEXT_PUBLIC_APP_URL or APP_URL', 500);
        const body = await req.json().catch(() => ({}));
        const { priceId, plan, interval, trialDays, trial } = body;
        let planKey = undefined;
        // Authorization: Bearer <idToken>
        const authHeader = req.headers.get('authorization') || '';
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!match) {
            return jsonError('Missing Authorization header', 401);
        }
        const idToken = match[1];
        // Verify Firebase ID token and get uid
        const firebaseAuth = firebaseAdmin_1.default.auth();
        let decoded;
        // Test harness: allow bypassing auth when running tests by sending
        // header `x-bypass-auth: 1` and setting NODE_ENV=test. This keeps
        // production behavior unchanged while allowing Playwright to exercise
        // the checkout route without a real Firebase token.
        const bypassHeader = (req.headers.get('x-bypass-auth') || '') === '1';
        if (process.env.NODE_ENV === 'test' && bypassHeader) {
            decoded = { uid: 'test-uid', email: 'test@example.com' };
        }
        else {
            try {
                decoded = await firebaseAuth.verifyIdToken(idToken);
            }
            catch (err) {
                console.error('[checkout] Invalid Firebase ID token', err);
                return jsonError('Invalid ID token', 401);
            }
        }
        const uid = decoded.uid;
        const email = decoded.email;
        if (!uid)
            return jsonError('Invalid token: no uid', 401);
        // Resolve priceId either directly or from plan
        let resolvedPriceId = undefined;
        if (priceId && typeof priceId === 'string') {
            if (!priceId.startsWith('price_'))
                return jsonError('Invalid priceId', 400);
            resolvedPriceId = priceId;
        }
        else if (plan && typeof plan === 'string') {
            const rawPlan = plan;
            const planAliasMap = { pro: 'creator', team: 'studio' };
            const planNormalized = (rawPlan || '').toString().trim().toLowerCase();
            const mappedPlan = planAliasMap[planNormalized] || planNormalized;
            // normalize interval
            const rawInterval = interval || 'monthly';
            let intervalNormalized = (rawInterval || '').toString().trim().toLowerCase();
            if (intervalNormalized === 'month')
                intervalNormalized = 'monthly';
            if (intervalNormalized === 'year' || intervalNormalized === 'yearly' || intervalNormalized === 'yr')
                intervalNormalized = 'annual';
            if (intervalNormalized.startsWith('ann'))
                intervalNormalized = 'annual';
            if (!['monthly', 'annual'].includes(intervalNormalized))
                intervalNormalized = 'monthly';
            planKey = mappedPlan;
            const priceForPlan = stripePrices_1.STRIPE_PRICES[planKey] && stripePrices_1.STRIPE_PRICES[planKey][intervalNormalized];
            if (!priceForPlan) {
                const availablePlans = Object.keys(stripePrices_1.STRIPE_PRICES);
                const availForPlan = stripePrices_1.STRIPE_PRICES[planKey] ? Object.keys(stripePrices_1.STRIPE_PRICES[planKey]) : [];
                return server_1.NextResponse.json({
                    error: 'Price not configured for plan',
                    received: { plan: rawPlan, interval: interval },
                    normalized: { plan: planKey, interval: intervalNormalized },
                    available: { plans: availablePlans, intervalsForNormalizedPlan: availForPlan },
                }, { status: 400 });
            }
            resolvedPriceId = priceForPlan;
        }
        else {
            return jsonError('Missing priceId or plan', 400);
        }
        // Lookup user doc in Firestore
        const db = firebaseAdmin_1.default.firestore();
        const userRef = db.collection('users').doc(uid);
        const userSnap = await userRef.get();
        const userData = userSnap.exists ? userSnap.data() : {};
        let customerId = userData?.stripeCustomerId;
        if (!customerId) {
            if (!server_2.stripe)
                return jsonError('Billing not configured', 503);
            // Create Stripe customer
            const customer = await server_2.stripe.customers.create({
                email: email || undefined,
                metadata: { firebaseUid: uid },
            });
            customerId = customer.id;
            await userRef.set({ stripeCustomerId: customerId }, { merge: true });
            console.log('[checkout] Created Stripe customer for uid', uid, customerId);
        }
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
        const successUrl = `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${appUrl}/pricing?canceled=1`;
        // Build subscription_data
        const subscription_data = {
            metadata: { uid, plan: planKey ?? (plan ?? '') },
        };
        if (typeof trialDays === 'number' && trialDays > 0) {
            subscription_data.trial_period_days = trialDays;
        }
        else if (trial) {
            subscription_data.trial_period_days = 7;
        }
        if (useMockStripe) {
            const mockUrl = `${appUrl}/_mock_stripe_checkout?plan=${encodeURIComponent(planKey ?? '')}&interval=${encodeURIComponent(interval ?? 'monthly')}&price=${encodeURIComponent(resolvedPriceId ?? '')}&uid=${encodeURIComponent(uid)}`;
            console.warn('[checkout] Using mock Stripe checkout (STRIPE_SECRET_KEY missing or not an sk_ key)');
            return server_1.NextResponse.json({ url: mockUrl });
        }
        if (!server_2.stripe)
            return jsonError('Billing not configured', 503);
        const session = await server_2.stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [{ price: resolvedPriceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: { uid, plan: planKey ?? (plan ?? '') },
            subscription_data,
        });
        return server_1.NextResponse.json({ url: session.url });
    }
    catch (err) {
        console.error('[checkout] Error creating session', err);
        const msg = err instanceof Error ? err.message : 'Failed to create checkout session';
        return server_1.NextResponse.json({ error: msg, where: 'checkout' }, { status: 500 });
    }
}
