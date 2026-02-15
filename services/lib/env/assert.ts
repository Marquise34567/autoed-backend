/**
 * Runtime environment assertions for server-side auth.
 * Importing this module and calling `assertServerEnv()` will throw
 * immediately if required env vars are missing so the app fails fast.
 */
export function assertServerEnv(): void {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SITE_URL',
  ]

  const missing = required.filter((k) => !process.env[k])
  if (missing.length) {
    throw new Error(
      `Missing required environment variables for auth: ${missing.join(', ')}. ` +
        `Set them in your environment or .env.local and restart the dev server.`
    )
  }

  // Basic sanity: ensure NEXT_PUBLIC_SUPABASE_URL looks like a Supabase URL
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  if (!url.includes('supabase.co') && !url.includes('localhost')) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL does not look like a valid Supabase URL')
  }
}

export function assertClientEnv(): void {
  // Client side only minimal checks (do not throw during SSR client bundles)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.warn('[env] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing')
  }
}
