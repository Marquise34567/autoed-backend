import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * POST /api/billing/reset
 * 
 * Test-only endpoint: Reset user to free tier
 * Only available in development + soft billing mode
 */
export async function POST(request: Request) {
  try {
    // Check if test mode is enabled
    const isSoftMode = process.env.BILLING_MODE === 'soft';
    const isDev = process.env.NODE_ENV === 'development';

    if (!isSoftMode || !isDev) {
      return NextResponse.json(
        { error: 'This endpoint is only available in soft billing mode' },
        { status: 403 }
      );
    }

    const cookieStore = await cookies();
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
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Cookies were set in a middleware
            }
          },
        },
      }
    );

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
      return NextResponse.json(
        { error: 'Failed to reset billing status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user_id: user.id,
      plan: 'free',
      status: 'locked',
      message: 'User reset to free tier',
    });
  } catch (error) {
    console.error('Reset endpoint error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
