export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.API_PROXY_TARGET || ''

function stripHostAndHopByHop(inHeaders = {}) {
  const hopByHop = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'host'
  ])
  const out = {}
  Object.entries(inHeaders).forEach(([k, v]) => {
    if (!k) return
    const lk = k.toLowerCase()
    if (hopByHop.has(lk)) return
    out[k] = v
  })
  return out
}

function buildTarget(base, path = '') {
  if (!base) throw new Error('BACKEND URL not configured')
  const b = String(base).replace(/\/+$/, '')
  let p = String(path || '').replace(/^\/+/, '')
  // Avoid duplicating '/api/api' when base already ends with '/api' and path starts with 'api/'
  if (/\/api$/.test(b) && p.startsWith('api/')) {
    p = p.replace(/^api\/+/, '')
  }
  return p ? `${b}/${p}` : b
}

async function doForward(request, params) {
  try {
    if (!BACKEND) {
      const body = JSON.stringify({ ok: false, error: 'Backend URL not configured' })
      return new NextResponse(body, { status: 502, headers: { 'content-type': 'application/json' } })
    }

    const path = (params && params.path) ? params.path.join('/') : ''
    const target = buildTarget(BACKEND, path)

    console.log('[proxy] incoming', request.method, request.url, '->', target)

    // Build headers to forward (strip host / hop-by-hop)
    const forwardHeaders = {}
    request.headers.forEach((v, k) => { forwardHeaders[k] = v })
    const safeHeaders = stripHostAndHopByHop(forwardHeaders)

    // Add some forwarding info
    safeHeaders['x-forwarded-host'] = request.headers.get('host') || ''
    safeHeaders['x-forwarded-proto'] = request.headers.get('x-forwarded-proto') || 'https'

    // Prepare body when present
    let body = undefined
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
      try {
        const ab = await request.arrayBuffer()
        if (ab && ab.byteLength) body = Buffer.from(ab)
        console.log('[proxy] body bytes:', body ? body.length : 0)
      } catch (e) {
        console.warn('[proxy] failed to read request body', e)
      }
    }

    const fetchOptions = {
      method: request.method,
      headers: safeHeaders,
      redirect: 'manual'
    }

    if (body) {
      fetchOptions.body = body
      // For streaming bodies in Node fetch, supply duplex; safe when runtime=nodejs
      fetchOptions.duplex = 'half'
    }

    const resp = await fetch(target, fetchOptions)

    // Copy response headers
    const responseHeaders = {}
    resp.headers.forEach((v, k) => {
      const lk = k.toLowerCase()
      if (['transfer-encoding', 'connection'].includes(lk)) return
      responseHeaders[k] = v
    })

    // Log minimal info
    console.log(`[proxy] ${request.method} ${target} -> ${resp.status}`)

    const respBuf = Buffer.from(await resp.arrayBuffer())
    return new NextResponse(respBuf, { status: resp.status, headers: responseHeaders })
  } catch (err) {
    console.error('[proxy] unexpected error forwarding request', err && (err.stack || err.message || err))
    const body = JSON.stringify({ ok: false, error: 'Proxy forward error', details: err && err.message })
    return new NextResponse(body, { status: 502, headers: { 'content-type': 'application/json' } })
  }
}

export async function GET(req, { params }) { return doForward(req, params) }
export async function POST(req, { params }) { return doForward(req, params) }
export async function PUT(req, { params }) { return doForward(req, params) }
export async function DELETE(req, { params }) { return doForward(req, params) }
export async function PATCH(req, { params }) { return doForward(req, params) }
export async function OPTIONS(req, { params }) { return doForward(req, params) }
export async function HEAD(req, { params }) { return doForward(req, params) }
