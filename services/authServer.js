"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.getUidFromRequest = getUidFromRequest;
const firebaseAdmin_1 = require("@/lib/firebaseAdmin");
function parseCookies(cookieHeader) {
    const out = {};
    if (!cookieHeader)
        return out;
    const pairs = cookieHeader.split(';');
    for (const p of pairs) {
        const idx = p.indexOf('=');
        if (idx === -1)
            continue;
        const k = p.slice(0, idx).trim();
        const v = p.slice(idx + 1).trim();
        out[k] = decodeURIComponent(v);
    }
    return out;
}
async function requireAuth(request, opts) {
    const authHeader = request.headers.get('authorization') || '';
    let token = null;
    if (authHeader.toLowerCase().startsWith('bearer '))
        token = authHeader.slice(7).trim();
    if (!token) {
        // try cookie
        const cookies = parseCookies(request.headers.get('cookie'));
        if (cookies['token'])
            token = cookies['token'];
    }
    // allow ?token= in development for EventSource where headers can't be set
    if (!token && opts?.allowQueryTokenInDev && process.env.NODE_ENV !== 'production') {
        try {
            const url = new URL(request.url);
            const q = url.searchParams.get('token');
            if (q)
                token = q;
        }
        catch (_) { }
    }
    if (!token) {
        throw new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    try {
        const decoded = await firebaseAdmin_1.adminAuth.verifyIdToken(token);
        return { uid: decoded.uid };
    }
    catch (e) {
        throw new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
}
async function getUidFromRequest(request) {
    const r = await requireAuth(request);
    return r.uid;
}
exports.default = { requireAuth, getUidFromRequest };
