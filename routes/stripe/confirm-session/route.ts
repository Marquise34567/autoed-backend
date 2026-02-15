/**
 * CONFIRM STRIPE CHECKOUT SESSION
 * POST /api/stripe/confirm-session
 * 
 * Confirms a Stripe Checkout Session after successful payment
 * Records subscription in Supabase with 'pending' or 'active' status
 * based on billing mode configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getBillingConfig, isBillingEnabled } from '@/lib/billing/config';
import { getStripe, isStripeConfigured } from '@/lib/stripe/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    const billingConfig = getBillingConfig();

    // Check if billing is enabled
    if (!isBillingEnabled()) {
      return NextResponse.json(
        { error: 'Billing is currently disabled' },
        { status: 403 }
      );
    }

    // Verify authentication
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { session_id } = body;

    if (!session_id || typeof session_id !== 'string') {
      return NextResponse.json(
        { error: 'session_id is required' },
        { status: 400 }
      );
    }

    console.log('[confirm-session] Retrieving session:', session_id);

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription', 'customer'],
    });

    console.log('[confirm-session] Session retrieved:', {
      id: session.id,
      payment_status: session.payment_status,
      status: session.status,
      customer: typeof session.customer === 'string' ? session.customer : session.customer?.id,
    });

    // Verify session belongs to this user
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (!profile || profile.stripe_customer_id !== customerId) {
      console.error('[confirm-session] Customer mismatch:', {
        sessionCustomer: customerId,
        profileCustomer: profile?.stripe_customer_id,
      });
      return NextResponse.json(
        { error: 'Session does not belong to authenticated user' },
        { status: 403 }
      );
    }

    // Check payment status
    if (session.payment_status !== 'paid') {
      return NextResponse.json(
        { error: `Payment not completed. Status: ${session.payment_status}` },
        { status: 400 }
      );
    }

    // Extract plan and subscription info
    const plan = session.metadata?.plan || 'starter';
    const subscriptionId = typeof session.subscription === 'string' 
      ? session.subscription 
      : session.subscription?.id;

    if (!subscriptionId) {
      return NextResponse.json(
        { error: 'No subscription ID found in session' },
        { status: 400 }
      );
    }

    // Determine status based on billing mode
    let status: 'pending' | 'active';
    if (billingConfig.mode === 'soft' && billingConfig.testAutoActivate) {
      status = 'active';
      console.log('[confirm-session] AUTO-ACTIVATING subscription (BILLING_TEST_AUTOACTIVATE=true)');
    } else if (billingConfig.mode === 'live') {
      // In live mode, webhooks will set to active
      status = 'pending';
      console.log('[confirm-session] Setting to pending (webhooks will activate)');
    } else {
      // Soft mode, manual activation required
      status = 'pending';
      console.log('[confirm-session] Setting to pending (manual activation required)');
    }

    console.log('[confirm-session] Updating billing_status:', {
      userId: user.id,
      plan,
      status,
      subscriptionId,
    });

    // Update billing_status in Supabase
    const { error: updateError } = await supabase
      .from('billing_status')
      .upsert({
        user_id: user.id,
        plan,
        status,
        stripe_subscription_id: subscriptionId,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (updateError) {
      console.error('[confirm-session] Database update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update billing status' },
        { status: 500 }
      );
    }

    console.log('[confirm-session] Success:', {
      userId: user.id,
      plan,
      status,
      mode: billingConfig.mode,
    });

    return NextResponse.json({
      success: true,
      plan,
      status,
      billingMode: billingConfig.mode,
      message: status === 'active' 
        ? 'Subscription activated successfully!' 
        : 'Payment received. Activation pending (test mode).',
    });
  } catch (error) {
    console.error('[confirm-session] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to confirm session';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
