import { NextRequest, NextResponse } from 'next/server';
import { validateReturnTo } from '@/lib/client/returnTo';
import type { PlanId } from '@/config/plans';
import { isBillingLive, getDemoUserId } from '@/lib/server/subscription';
import { STRIPE_PRICE_LOOKUPS, getAppUrl } from '@/lib/stripe/config';
import { getStripe, isStripeConfigured } from '@/lib/stripe/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout Session for subscription.
 * 
 * Request:
 * {
 *   plan: "starter" | "creator" | "studio"
 *   returnTo: "/editor" (internal path, validated)
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   url: "https://checkout.stripe.com/..." (Stripe checkout URL)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json(
        { ok: false, error: 'Stripe is not configured on the server' },
        { status: 500 }
      );
    }

    const stripe = getStripe();

    // CRITICAL SAFETY: Block checkout if billing is not live
    if (!isBillingLive()) {
      return NextResponse.json(
        {
          ok: false,
          code: "BILLING_DISABLED",
          error: "Billing is not active yet. No charges will be made.",
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { plan, returnTo } = body as { plan: PlanId; returnTo?: string };

    // Validate inputs
    if (!plan || !['starter', 'creator', 'studio'].includes(plan)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid plan. Must be starter, creator, or studio.' },
        { status: 400 }
      );
    }

    // Validate and sanitize returnTo
    const validatedReturnTo = validateReturnTo(returnTo);
    
    // Get user ID (TODO: replace with real auth)
    const userId = getDemoUserId();
    
    // Get the price lookup key
    const priceLookup = STRIPE_PRICE_LOOKUPS[plan as keyof typeof STRIPE_PRICE_LOOKUPS];
    if (!priceLookup) {
      return NextResponse.json(
        { ok: false, error: `No price configured for plan: ${plan}` },
        { status: 500 }
      );
    }

    // Build absolute URLs for Stripe redirects
    const appUrl = getAppUrl();
    const successUrl = `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}&returnTo=${encodeURIComponent(validatedReturnTo)}`;
    const cancelUrl = `${appUrl}/pricing?plan=${plan}&returnTo=${encodeURIComponent(validatedReturnTo)}`;

    console.log('[checkout] Creating Stripe session:', {
      plan,
      priceLookup,
      userId,
      returnTo: validatedReturnTo,
      successUrl,
      cancelUrl,
    });

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `AutoEditor ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
              description: `Monthly subscription to AutoEditor ${plan} plan`,
            },
            unit_amount: plan === 'starter' ? 900 : plan === 'creator' ? 2900 : 9900,
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata: {
        userId,
        plan,
        returnTo: validatedReturnTo,
      },
      subscription_data: {
        metadata: {
          userId,
          plan,
        },
      },
    });

    console.log('[checkout] Stripe session created:', session.id);

    return NextResponse.json(
      {
        ok: true,
        url: session.url,
        sessionId: session.id,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[checkout] Error:', errorMsg, error);

    return NextResponse.json(
      { ok: false, error: 'Failed to create checkout session', details: errorMsg },
      { status: 500 }
    );
  }
}
