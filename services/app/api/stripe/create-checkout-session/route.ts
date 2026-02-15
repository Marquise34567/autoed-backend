/**
 * CREATE STRIPE CHECKOUT SESSION
 * POST /api/stripe/create-checkout-session
 * 
 * Creates a Stripe Checkout Session for subscription purchase
 * Requires authenticated user and valid Stripe configuration
 * Uses real production-mode Stripe API
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getPlanPriceId, getPlanMetadata } from '@/lib/billing/config';
import { getStripe, isStripeConfigured } from '@/lib/stripe/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // === LOGGING: Request metadata ===
    const requestHeaders = request.headers;
    const cookieHeader = requestHeaders.get('cookie') || '';
    console.log('[checkout:hit] POST /api/stripe/create-checkout-session');
    console.log('[checkout:cookies_count] Cookie header present:', !!cookieHeader);
    console.log('[checkout:cookies_count] Cookie length:', cookieHeader.length);
    
    // Log individual cookies for debugging
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    console.log('[checkout:cookies_count] Total cookies:', allCookies.length);
    console.log('[checkout:cookies_count] Cookie names:', allCookies.map(c => c.name).join(', '));

    // Validate Stripe configuration - REQUIRED
    if (!isStripeConfigured()) {
      console.error('[checkout:error] Stripe is not configured. Set STRIPE_SECRET_KEY.');
      return NextResponse.json(
        { error: 'Stripe is not configured. Contact support.' },
        { status: 500 }
      );
    }

    const stripe = getStripe();

    // === LOGGING: Auth attempt ===
    console.log('[checkout:auth] Creating Supabase client and checking session...');
    
    // Create Supabase client with standard SSR cookie handling
    // cookies() from next/headers automatically handles request/response cookie sync
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
              // Can ignore - cookies() will automatically sync to response
              console.error('[checkout:cookie_error]', error);
            }
          },
        },
      }
    );

    console.log('[checkout:auth] Calling supabase.auth.getUser()...');
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError) {
      console.error('[checkout:auth_error] Auth error:', authError.message);
      console.error('[checkout:auth_error] Error details:', authError);
      return NextResponse.json(
        { 
          error: 'Unauthorized',
          message: 'Please sign in to upgrade.'
        },
        { status: 401 }
      );
    }

    if (!user) {
      console.error('[checkout:no_session] No user found in session');
      console.error('[checkout:no_session] Debug - Cookie header:', cookieHeader.substring(0, 100));
      console.error('[checkout:no_session] Debug - Parsed cookies:', allCookies.length, 'cookies available');
      return NextResponse.json(
        { 
          error: 'Unauthorized',
          message: 'Please sign in to upgrade.'
        },
        { status: 401 }
      );
    }

    console.log('[checkout:userId] ✓ User authenticated:', user.id, user.email);

    // Parse request body
    const body = await request.json();
    const { plan } = body;

    if (!plan || typeof plan !== 'string') {
      return NextResponse.json(
        { error: 'Plan is required (starter, creator, or studio)' },
        { status: 400 }
      );
    }

    const planLower = plan.toLowerCase();
    if (!['starter', 'creator', 'studio'].includes(planLower)) {
      return NextResponse.json(
        { error: 'Invalid plan. Must be starter, creator, or studio' },
        { status: 400 }
      );
    }

    // Get price ID for the plan
    const priceId = getPlanPriceId(planLower);
    if (!priceId) {
      console.error('[checkout] Missing price ID for plan:', planLower);
      return NextResponse.json(
        { 
          error: `Pricing not configured for ${planLower} plan. Contact support.`,
          code: 'PRICE_NOT_CONFIGURED'
        },
        { status: 500 }
      );
    }

    console.log('[checkout] Creating session:', {
      userId: user.id,
      email: user.email,
      plan: planLower,
      priceId,
    });

    // Get or create Stripe customer
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    let customerId = profile?.stripe_customer_id;

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      console.log('[checkout] Creating new Stripe customer');
      const customer = await stripe.customers.create({
        email: user.email!,
        metadata: {
          supabase_user_id: user.id,
        },
      });
      customerId = customer.id;

      // Save customer ID to profile
      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);

      console.log('[checkout] Stripe customer created:', customerId);
    }

    // Determine success URL based on billing mode
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
    const successUrl = `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appUrl}/pricing?canceled=1`;

    // Support optional trial flag (e.g. { trial: true }) to create a trialing subscription
    const { trial } = body as { trial?: boolean };
    const trialDays = trial ? 7 : undefined;

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        ...getPlanMetadata(planLower),
        user_id: user.id,
        user_email: user.email || '',
      },
      subscription_data: {
        metadata: {
          ...getPlanMetadata(planLower),
          user_id: user.id,
        },
        ...(trialDays ? { trial_period_days: trialDays } : {}),
      },
    });

    console.log('[checkout:stripe_session_created] ✓ Session created:', {
      sessionId: session.id,
      url: session.url,
    });

    // cookies() automatically syncs set cookies to the response
    return NextResponse.json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error('[checkout:error] Fatal error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create checkout session';
    return NextResponse.json(
      { error: message, message: 'Unable to process checkout. Please try again.' },
      { status: 500 }
    );
  }
}
