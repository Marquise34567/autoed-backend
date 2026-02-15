import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { adminAuth } from '@/lib/firebaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const cookieStore = await cookies()
  const session = cookieStore.get('session')?.value

  if (!session) {
    return NextResponse.json({ success: false, user: null }, { status: 200 })
  }

  try {
    const decoded = await adminAuth.verifySessionCookie(session, true)
    return NextResponse.json({ success: true, user: decoded }, { status: 200 })
  } catch {
    return NextResponse.json({ success: false, user: null }, { status: 200 })
  }
}
