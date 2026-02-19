"use strict";
/**
 * CONFIRM STRIPE CHECKOUT SESSION
 * POST /api/stripe/confirm-session
 *
 * Confirms a Stripe Checkout Session after successful payment
 * Records subscription in Supabase with 'pending' or 'active' status
 * based on billing mode configuration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = exports.runtime = void 0;
exports.POST = POST;
const server_1 = require("next/server");
const server_2 = require("@/lib/supabase/server");
const config_1 = require("@/lib/billing/config");
const server_3 = require("@/lib/stripe/server");
exports.runtime = 'nodejs';
exports.dynamic = 'force-dynamic';
async function POST(request) {
    try {
        // Validate Stripe configuration
        if (!(0, server_3.isStripeConfigured)()) {
            return server_1.NextResponse.json({ error: 'Stripe is not configured on the server' }, { status: 500 });
        }
        const stripe = (0, server_3.getStripe)();
        const billingConfig = (0, config_1.getBillingConfig)();
        // Check if billing is enabled
        if (!(0, config_1.isBillingEnabled)()) {
            return server_1.NextResponse.json({ error: 'Billing is currently disabled' }, { status: 403 });
        }
        // Verify authentication
        const supabase = await (0, server_2.createClient)();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return server_1.NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }
        // Parse request body
        const body = await request.json();
        const { session_id } = body;
        if (!session_id || typeof session_id !== 'string') {
            return server_1.NextResponse.json({ error: 'session_id is required' }, { status: 400 });
        }
        console.log('[confirm-session] Retrieving session:', session_id);
        // Retrieve the session from Stripe
        const session = await stripe.checkout.sessions.retrieve(session_id, {
            expand: ['subscription', 'customer'],
        });
        console.log('[confirm-session] Session retrieved:', {
            id: session.id,
            payment_status: session.payment_status,
            status: session.status,
            customer: typeof session.customer === 'string' ? session.customer : session.customer?.id,
        });
        // Verify session belongs to this user
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        const { data: profile } = await supabase
            .from('profiles')
            .select('stripe_customer_id')
            .eq('id', user.id)
            .single();
        if (!profile || profile.stripe_customer_id !== customerId) {
            console.error('[confirm-session] Customer mismatch:', {
                sessionCustomer: customerId,
                profileCustomer: profile?.stripe_customer_id,
            });
            return server_1.NextResponse.json({ error: 'Session does not belong to authenticated user' }, { status: 403 });
        }
        // Check payment status
        if (session.payment_status !== 'paid') {
            return server_1.NextResponse.json({ error: `Payment not completed. Status: ${session.payment_status}` }, { status: 400 });
        }
        // Extract plan and subscription info
        const plan = session.metadata?.plan || 'starter';
        const subscriptionId = typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
        if (!subscriptionId) {
            return server_1.NextResponse.json({ error: 'No subscription ID found in session' }, { status: 400 });
        }
        // Determine status based on billing mode
        let status;
        if (billingConfig.mode === 'soft' && billingConfig.testAutoActivate) {
            status = 'active';
            console.log('[confirm-session] AUTO-ACTIVATING subscription (BILLING_TEST_AUTOACTIVATE=true)');
        }
        else if (billingConfig.mode === 'live') {
            // In live mode, webhooks will set to active
            status = 'pending';
            console.log('[confirm-session] Setting to pending (webhooks will activate)');
        }
        else {
            // Soft mode, manual activation required
            status = 'pending';
            console.log('[confirm-session] Setting to pending (manual activation required)');
        }
        console.log('[confirm-session] Updating billing_status:', {
            userId: user.id,
            plan,
            status,
            subscriptionId,
        });
        // Update billing_status in Supabase
        const { error: updateError } = await supabase
            .from('billing_status')
            .upsert({
            user_id: user.id,
            plan,
            status,
            stripe_subscription_id: subscriptionId,
            updated_at: new Date().toISOString(),
        }, {
            onConflict: 'user_id',
        });
        if (updateError) {
            console.error('[confirm-session] Database update error:', updateError);
            return server_1.NextResponse.json({ error: 'Failed to update billing status' }, { status: 500 });
        }
        console.log('[confirm-session] Success:', {
            userId: user.id,
            plan,
            status,
            mode: billingConfig.mode,
        });
        return server_1.NextResponse.json({
            success: true,
            plan,
            status,
            billingMode: billingConfig.mode,
            message: status === 'active'
                ? 'Subscription activated successfully!'
                : 'Payment received. Activation pending (test mode).',
        });
    }
    catch (error) {
        console.error('[confirm-session] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to confirm session';
        return server_1.NextResponse.json({ error: message }, { status: 500 });
    }
}
