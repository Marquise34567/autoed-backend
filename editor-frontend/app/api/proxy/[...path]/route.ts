import { NextRequest, NextResponse } from 'next/server'

const BACKEND = process.env.API_PROXY_TARGET || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080'

async function forward(request: NextRequest, params: { path?: string[] }) {
  try {
    let path = (params.path || []).join('/')
    // Ensure forwarded path always includes the top-level `api` segment so backend routes match.
    if (path && !path.startsWith('api/')) path = `api/${path}`
    const target = `${BACKEND.replace(/\/$/, '')}/${path}`

    // Clone headers (exclude host)
    const headers: Record<string, string> = {}
    request.headers.forEach((v, k) => {
      if (k.toLowerCase() === 'host') return
      headers[k] = v
    })

    // Forward body when present (preserve raw bytes)
    let body: ArrayBuffer | undefined = undefined
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const ab = await request.arrayBuffer()
      if (ab && ab.byteLength) body = ab
    }

    let resp: Response
    try {
      resp = await fetch(target, {
        method: request.method,
        headers,
        body: body as any,
        redirect: 'manual',
      })
    } catch (fetchErr: any) {
      console.error('[proxy] fetch network error', { target, error: fetchErr && (fetchErr.stack || fetchErr.message || fetchErr) })
      return new NextResponse(JSON.stringify({ ok: false, error: 'Proxy network error', details: fetchErr && fetchErr.message }), { status: 502, headers: { 'content-type': 'application/json' } })
    }

    // Always log target and upstream status
    console.log('[proxy] upstream', target, '->', resp.status)

    // If upstream returned an error, read and log the response text and forward it verbatim
    if (resp.status >= 400) {
      let text: string | null = null
      try {
        text = await resp.text()
      } catch (e) {
        console.error('[proxy] failed reading upstream error body', { target, status: resp.status, err: e && (e.stack || e.message || e) })
      }

      console.error('[proxy] upstream error body', { target, status: resp.status, body: text })

      // Preserve upstream content-type if present, otherwise default to application/json
      const ct = resp.headers.get('content-type') || 'application/json'
      const headersOut: Record<string, string> = { 'content-type': ct }
      resp.headers.forEach((v, k) => { headersOut[k] = v })

      // Return exact upstream body (as text) with original status and headers
      return new NextResponse(text, { status: resp.status, headers: headersOut })
    }

    // Non-error: stream response through, copying headers
    const responseHeaders: Record<string, string> = {}
    resp.headers.forEach((v, k) => { responseHeaders[k] = v })

    return new NextResponse(resp.body, { status: resp.status, headers: responseHeaders })
  } catch (err: any) {
    console.error('[proxy] forward error', err && (err.stack || err.message || err))
    return new NextResponse(JSON.stringify({ ok: false, error: 'Proxy forward error', details: err && err.message }), { status: 500, headers: { 'content-type': 'application/json' } })
  }
}

export async function GET(req: NextRequest, { params }: { params: { path?: string[] } }) { return forward(req, params) }
export async function POST(req: NextRequest, { params }: { params: { path?: string[] } }) { return forward(req, params) }
export async function PUT(req: NextRequest, { params }: { params: { path?: string[] } }) { return forward(req, params) }
export async function DELETE(req: NextRequest, { params }: { params: { path?: string[] } }) { return forward(req, params) }
export async function PATCH(req: NextRequest, { params }: { params: { path?: string[] } }) { return forward(req, params) }
export async function OPTIONS(req: NextRequest, { params }: { params: { path?: string[] } }) { return forward(req, params) }
export async function HEAD(req: NextRequest, { params }: { params?: { path?: string[] } }) { return forward(req, params) }
