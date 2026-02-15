import { NextRequest, NextResponse } from 'next/server'

const BACKEND = process.env.API_PROXY_TARGET || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080'

async function forward(request: NextRequest, params: { path?: string[] }) {
  try {
    const path = (params.path || []).join('/')
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

    const resp = await fetch(target, {
      method: request.method,
      headers,
      body: body as any,
      redirect: 'manual',
    })

    // Copy response headers
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
