import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/server'

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get('session_id')
    if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

    if (!stripe) return NextResponse.json({ ok: false, error: 'Billing not configured' }, { status: 503 })
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    const uid = session.metadata?.uid || null
    return NextResponse.json({ uid })
  } catch (err) {
    console.error('[session] error', err)
    return NextResponse.json({ error: 'Failed to retrieve session' }, { status: 500 })
  }
}
