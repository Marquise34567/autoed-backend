"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const server_2 = require("@/lib/supabase/server");
const config_1 = require("@/lib/billing/config");
/**
 * MANUAL BILLING ACTIVATION (TESTING ONLY)
 * POST /api/billing/manual-activate
 *
 * Manually activates a subscription for testing purposes
 * Requires admin key authentication
 * Only enabled when BILLING_TEST_ALLOW_MANUAL_ACTIVATE=true
 *
 * Headers:
 *   x-admin-key: Admin secret key (BILLING_ADMIN_KEY)
 *
 * Body:
 *   { user_id: string, plan: "starter" | "creator" | "studio" }
 */
async function POST(request) {
    try {
        const billingConfig = (0, config_1.getBillingConfig)();
        // Check if manual activation is allowed
        if (!billingConfig.testAllowManualActivate) {
            return server_1.NextResponse.json({ error: 'Manual activation is disabled. Set BILLING_TEST_ALLOW_MANUAL_ACTIVATE=true' }, { status: 403 });
        }
        // Verify admin key
        const adminKey = request.headers.get('x-admin-key');
        if (!adminKey || !billingConfig.adminKey || adminKey !== billingConfig.adminKey) {
            console.error('[manual-activate] Invalid admin key');
            return server_1.NextResponse.json({ error: 'Invalid admin key' }, { status: 401 });
        }
        // Parse request body
        const { user_id, plan } = await request.json();
        if (!user_id || typeof user_id !== 'string') {
            return server_1.NextResponse.json({ error: 'user_id is required' }, { status: 400 });
        }
        if (!plan || !['free', 'starter', 'creator', 'studio'].includes(plan)) {
            return server_1.NextResponse.json({ error: 'Valid plan is required (free, starter, creator, or studio)' }, { status: 400 });
        }
        console.log('[manual-activate] Activating subscription:', {
            userId: user_id,
            plan,
            mode: billingConfig.mode,
        });
        // Use supabase client to update billing_status
        const supabase = await (0, server_2.createClient)();
        // Determine status - active if manual activation is allowed
        const status = 'active';
        // Update billing_status
        const { error: updateError } = await supabase
            .from('billing_status')
            .upsert({
            user_id,
            plan,
            status,
            updated_at: new Date().toISOString(),
        }, {
            onConflict: 'user_id',
        });
        if (updateError) {
            console.error('[manual-activate] Database update error:', updateError);
            return server_1.NextResponse.json({ error: 'Failed to update billing status', details: updateError.message }, { status: 500 });
        }
        console.log('[manual-activate] Success:', { userId: user_id, plan, status });
        return server_1.NextResponse.json({
            success: true,
            user_id,
            plan,
            status,
            message: 'Subscription manually activated (test mode)',
        });
    }
    catch (error) {
        console.error('[manual-activate] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to activate subscription';
        return server_1.NextResponse.json({ error: message }, { status: 500 });
    }
}
