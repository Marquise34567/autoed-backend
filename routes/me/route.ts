/**
 * DEBUG SESSION ENDPOINT
 * GET /api/me
 * 
 * Returns current user session status for debugging
 * Uses Supabase SSR with proper cookie handling
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Lightweight hit marker; cookie details kept minimal
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();

    // Create Supabase client with SSR cookie handling
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options);
              });
            } catch (error) {
              console.error('[api/me:cookie_error]', error);
            }
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    // Single structured log for observability
    console.log('[api/me] user=' + (user?.id ?? 'null') + ' cookies=' + allCookies.length);

    if (authError || !user) {
      return NextResponse.json(
        {
          signedIn: false,
          user: null,
          cookies: allCookies.length,
          cookieNames: allCookies.map(c => c.name),
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      signedIn: true,
      userId: user.id,
      email: user.email,
      cookies: allCookies.length,
    });
  } catch (error) {
    console.error('[api/me:error]', error);
    return NextResponse.json(
      { signedIn: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}
