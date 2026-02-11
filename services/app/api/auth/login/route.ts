import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const idToken = (body as { idToken?: unknown })?.idToken
  if (typeof idToken !== 'string' || idToken.trim() === '') {
    return NextResponse.json({ success: false, error: 'Missing idToken' }, { status: 400 })
  }

  try {
    const expiresIn = 5 * 24 * 60 * 60 * 1000
    const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn })

    const res = NextResponse.json({ success: true }, { status: 200 })
    res.cookies.set('session', sessionCookie, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: expiresIn / 1000,
    })

    return res
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to create session' },
      { status: 500 }
    )
  }
}
