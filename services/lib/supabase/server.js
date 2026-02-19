"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClient = createClient;
exports.createApiRouteClient = createApiRouteClient;
exports.createAdminClient = createAdminClient;
const headers_1 = require("next/headers");
const ssr_1 = require("@supabase/ssr");
const supabase_js_1 = require("@supabase/supabase-js");
/**
 * Server-side Supabase client for Server Components
 * Automatically persists session cookies via next/headers
 */
async function createClient() {
    const cookieStore = await (0, headers_1.cookies)();
    return (0, ssr_1.createServerClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        cookies: {
            getAll() {
                return cookieStore.getAll();
            },
            setAll(cookiesToSet) {
                try {
                    cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
                }
                catch {
                    // Silently fail if cookies cannot be set
                }
            },
        },
    });
}
/**
 * API Route helper: Creates a Supabase server client that properly
 * sets cookies on the response object
 */
async function createApiRouteClient(responseObj) {
    const cookieStore = await (0, headers_1.cookies)();
    const cookiesToSet = [];
    const supabase = (0, ssr_1.createServerClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        cookies: {
            getAll() {
                return cookieStore.getAll();
            },
            setAll(cookies) {
                cookies.forEach(({ name, value, options }) => {
                    cookiesToSet.push({ name, value, options });
                    responseObj.cookies.set(name, value, options);
                });
            },
        },
    });
    return {
        supabase,
        response: responseObj,
        cookies: cookiesToSet,
    };
}
/**
 * Admin client with service role key for elevated operations
 * USE WITH CAUTION: Bypasses Row Level Security (RLS)
 */
function createAdminClient() {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    }
    return (0, supabase_js_1.createClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}
