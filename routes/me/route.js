"use strict";
/**
 * DEBUG SESSION ENDPOINT
 * GET /api/me
 *
 * Returns current user session status for debugging
 * Uses Supabase SSR with proper cookie handling
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = exports.runtime = void 0;
exports.GET = GET;
const server_1 = require("next/server");
const ssr_1 = require("@supabase/ssr");
const headers_1 = require("next/headers");
exports.runtime = 'nodejs';
exports.dynamic = 'force-dynamic';
async function GET(request) {
    try {
        // Lightweight hit marker; cookie details kept minimal
        const cookieStore = await (0, headers_1.cookies)();
        const allCookies = cookieStore.getAll();
        // Create Supabase client with SSR cookie handling
        const supabase = (0, ssr_1.createServerClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            cookieStore.set(name, value, options);
                        });
                    }
                    catch (error) {
                        console.error('[api/me:cookie_error]', error);
                    }
                },
            },
        });
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        // Single structured log for observability
        console.log('[api/me] user=' + (user?.id ?? 'null') + ' cookies=' + allCookies.length);
        if (authError || !user) {
            return server_1.NextResponse.json({
                signedIn: false,
                user: null,
                cookies: allCookies.length,
                cookieNames: allCookies.map(c => c.name),
            }, { status: 200 });
        }
        return server_1.NextResponse.json({
            signedIn: true,
            userId: user.id,
            email: user.email,
            cookies: allCookies.length,
        });
    }
    catch (error) {
        console.error('[api/me:error]', error);
        return server_1.NextResponse.json({ signedIn: false, error: 'Internal error' }, { status: 500 });
    }
}
