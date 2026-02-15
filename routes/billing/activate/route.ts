import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getBillingConfig } from '@/lib/billing/config';

export const runtime = 'nodejs';

/**
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
export async function POST(request: Request) {
  try {
    const billingConfig = getBillingConfig();

    // Check if manual activation is allowed
    if (!billingConfig.testAllowManualActivate) {
      return NextResponse.json(
        {
          error:
            'Manual activation is disabled. Set BILLING_TEST_ALLOW_MANUAL_ACTIVATE=true',
        },
        { status: 403 }
      );
    }

    // Verify admin key
    const adminKey = request.headers.get('x-admin-key');
    if (
      !adminKey ||
      !billingConfig.adminKey ||
      adminKey !== billingConfig.adminKey
    ) {
      console.error('[manual-activate] Invalid admin key');
      return NextResponse.json({ error: 'Invalid admin key' }, { status: 401 });
    }

    // Parse request body
    const { user_id, plan } = await request.json();

    if (!user_id || typeof user_id !== 'string') {
      return NextResponse.json(
        { error: 'user_id is required' },
        { status: 400 }
      );
    }

    if (!plan || !['free', 'starter', 'creator', 'studio'].includes(plan)) {
      return NextResponse.json(
        {
          error:
            'Valid plan is required (free, starter, creator, or studio)',
        },
        { status: 400 }
      );
    }

    console.log('[manual-activate] Activating subscription:', {
      userId: user_id,
      plan,
      mode: billingConfig.mode,
    });

    // Use server client to update billing_status
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

    // Update billing_status
    const { error: updateError } = await supabase
      .from('billing_status')
      .upsert({
        user_id,
        plan,
        status: 'active', // MANUAL ACTIVATION
        stripe_subscription_id: null,
        updated_at: new Date().toISOString(),
      });

    if (updateError) {
      console.error('Failed to activate billing:', updateError);
      return NextResponse.json(
        { error: 'Failed to activate subscription' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user_id,
      plan,
      status: 'active',
      message: 'User manually activated',
    });
  } catch (error) {
    console.error('Billing activation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
