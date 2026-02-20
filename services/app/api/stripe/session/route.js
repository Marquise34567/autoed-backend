"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const server_2 = require("@/lib/stripe/server");
if (!server_2.stripe) {
    // Exported route will still compile, but runtime will return 503 when called.
}
async function GET(req) {
    try {
        const sessionId = req.nextUrl.searchParams.get('session_id');
        if (!sessionId)
            return server_1.NextResponse.json({ error: 'session_id required' }, { status: 400 });
        if (!server_2.stripe)
            return server_1.NextResponse.json({ ok: false, error: 'Billing not configured' }, { status: 503 });
        const session = await server_2.stripe.checkout.sessions.retrieve(sessionId);
        const uid = session.metadata?.uid || null;
        return server_1.NextResponse.json({ uid });
    }
    catch (err) {
        console.error('[session] error', err);
        return server_1.NextResponse.json({ error: 'Failed to retrieve session' }, { status: 500 });
    }
}
