import { adminAuth } from '@/lib/firebaseAdmin'

function parseCookies(cookieHeader: string | null) {
  const out: Record<string,string> = {}
  if (!cookieHeader) return out
  const pairs = cookieHeader.split(';')
  for (const p of pairs) {
    const idx = p.indexOf('=')
    if (idx === -1) continue
    const k = p.slice(0, idx).trim()
    const v = p.slice(idx+1).trim()
    out[k] = decodeURIComponent(v)
  }
  return out
}

export async function requireAuth(request: Request, opts?: { allowQueryTokenInDev?: boolean }) {
  const authHeader = request.headers.get('authorization') || ''
  let token: string | null = null
  if (authHeader.toLowerCase().startsWith('bearer ')) token = authHeader.slice(7).trim()

  if (!token) {
    // try cookie
    const cookies = parseCookies(request.headers.get('cookie'))
    if (cookies['token']) token = cookies['token']
  }

  // allow ?token= in development for EventSource where headers can't be set
  if (!token && opts?.allowQueryTokenInDev && process.env.NODE_ENV !== 'production') {
    try {
      const url = new URL(request.url)
      const q = url.searchParams.get('token')
      if (q) token = q
    } catch (_) {}
  }

  if (!token) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token)
    return { uid: decoded.uid }
  } catch (e) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
}

export async function getUidFromRequest(request: Request) {
  const r = await requireAuth(request)
  return r.uid
}

export default { requireAuth, getUidFromRequest }
