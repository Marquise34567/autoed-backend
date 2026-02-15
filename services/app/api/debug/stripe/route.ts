import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const key = process.env.STRIPE_SECRET_KEY || null;
    const prefix = key && typeof key === 'string' && key.length >= 7 ? key.slice(0, 7) : null;
    const hasStripeSecret = !!(key && (key.startsWith('sk_test') || key.startsWith('sk_live')));
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || null;

    return NextResponse.json({
      hasStripeSecret,
      stripeSecretPrefix: prefix,
      appUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
