"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.POST = POST;
const ssr_1 = require("@supabase/ssr");
const headers_1 = require("next/headers");
const server_1 = require("next/server");
exports.runtime = 'nodejs';
/**
 * POST /api/billing/reset
 *
 * Test-only endpoint: Reset user to free tier
 * Only available in development + soft billing mode
 */
async function POST(request) {
    try {
        // Check if test mode is enabled
        const isSoftMode = process.env.BILLING_MODE === 'soft';
        const isDev = process.env.NODE_ENV === 'development';
        if (!isSoftMode || !isDev) {
            return server_1.NextResponse.json({ error: 'This endpoint is only available in soft billing mode' }, { status: 403 });
        }
        const cookieStore = await (0, headers_1.cookies)();
        const supabase = (0, ssr_1.createServerClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
                    }
                    catch {
                        // Cookies were set in a middleware
                    }
                },
            },
        });
        // Get current user
        const { data: { user }, } = await supabase.auth.getUser();
        if (!user) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        // Reset to free/locked
        const { data, error } = await supabase
            .from('billing_status')
            .upsert({
            user_id: user.id,
            plan: 'free',
            status: 'locked',
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
        })
            .select()
            .single();
        if (error) {
            console.error('Reset error:', error);
            return server_1.NextResponse.json({ error: 'Failed to reset billing status' }, { status: 500 });
        }
        return server_1.NextResponse.json({
            success: true,
            user_id: user.id,
            plan: 'free',
            status: 'locked',
            message: 'User reset to free tier',
        });
    }
    catch (error) {
        console.error('Reset endpoint error:', error);
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
