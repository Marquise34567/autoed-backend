"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSupabaseServerClient = createSupabaseServerClient;
const headers_1 = require("next/headers");
const ssr_1 = require("@supabase/ssr");
/**
 * Helper used by server-side utilities to create a Supabase client
 * that reads/writes cookies via Next.js cookie store.
 */
async function createSupabaseServerClient() {
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
                    // ignore
                }
            },
        },
    });
}
