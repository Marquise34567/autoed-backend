import { NextRequest, NextResponse } from 'next/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe/server';
import { getDemoUserId } from '@/lib/server/subscription';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/checkout
 * Creates a Stripe Checkout Session for subscription purchase
 * 
 * Body:
 *   - priceId: Stripe Price ID (e.g., price_1ABC...)
 *   - returnTo: URL to redirect after success (default: /editor)
 * 
 * Returns:
 *   - { url: string } - Stripe Checkout Session URL
 */
export async function POST(request: NextRequest) {
  try {
        // Validate Stripe configuration
        if (!isStripeConfigured()) {
          return NextResponse.json(
            { error: 'Stripe is not configured on the server' },
            { status: 500 }
          );
        }

        const stripe = getStripe();

    const body = await request.json();
    const { priceId, returnTo } = body as { priceId: string; returnTo?: string };

    // Validate priceId
    if (!priceId || typeof priceId !== 'string' || !priceId.startsWith('price_')) {
      return NextResponse.json(
        { error: 'Invalid priceId. Must be a Stripe Price ID (starts with price_)' },
        { status: 400 }
      );
    }

    const userId = getDemoUserId();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
    const returnPath = returnTo || '/editor';

    console.log('[checkout] Creating session:', { priceId, userId, returnPath });

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      // Success URL includes session_id and returnTo parameter
      success_url: `${appUrl}/api/billing/success?session_id={CHECKOUT_SESSION_ID}&returnTo=${encodeURIComponent(returnPath)}`,
      cancel_url: `${appUrl}/pricing?canceled=1`,
      metadata: {
        userId,
        returnTo: returnPath,
      },
      client_reference_id: userId,
    });

    console.log('[checkout] Session created:', session.id);
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('[checkout] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
