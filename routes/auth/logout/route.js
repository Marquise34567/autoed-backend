"use strict";
/**
 * Logout API endpoint
 * POST /api/auth/logout
 *
 * Uses Supabase Auth to sign out users
 * Clears session cookies
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = exports.runtime = void 0;
exports.POST = POST;
const server_1 = require("@/lib/supabase/server");
const server_2 = require("next/server");
exports.runtime = 'nodejs';
exports.dynamic = 'force-dynamic';
async function POST(request) {
    try {
        // Create Supabase client with proper response cookie handling
        const responseObj = server_2.NextResponse.json({ success: false });
        const { supabase, response } = await (0, server_1.createApiRouteClient)(responseObj);
        // Sign out with Supabase (clears session cookies)
        console.log('[api:auth:logout] Signing out user');
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error('[api:auth:logout] Signout error:', error.message);
            return server_2.NextResponse.json({ success: false, error: error.message }, { status: 400 });
        }
        console.log('[api:auth:logout] Logout successful');
        // Return success - cookies cleared
        const successResponse = server_2.NextResponse.json({ success: true }, { status: 200 });
        // Copy cookies (which now have cleared session cookies)
        response.cookies.getAll().forEach(({ name, value }) => {
            successResponse.cookies.set(name, value);
        });
        return successResponse;
    }
    catch (error) {
        console.error('[api:auth:logout] Error:', error);
        return server_2.NextResponse.json({ success: false, error: 'Logout failed' }, { status: 500 });
    }
}
