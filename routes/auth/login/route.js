"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = exports.runtime = void 0;
exports.POST = POST;
const server_1 = require("next/server");
const firebaseAdmin_1 = require("@/lib/firebaseAdmin");
exports.runtime = 'nodejs';
exports.dynamic = 'force-dynamic';
async function POST(request) {
    let body;
    try {
        body = await request.json();
    }
    catch {
        return server_1.NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const idToken = body?.idToken;
    if (typeof idToken !== 'string' || idToken.trim() === '') {
        return server_1.NextResponse.json({ success: false, error: 'Missing idToken' }, { status: 400 });
    }
    try {
        const expiresIn = 5 * 24 * 60 * 60 * 1000;
        const sessionCookie = await firebaseAdmin_1.adminAuth.createSessionCookie(idToken, { expiresIn });
        const res = server_1.NextResponse.json({ success: true }, { status: 200 });
        res.cookies.set('session', sessionCookie, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            maxAge: expiresIn / 1000,
        });
        return res;
    }
    catch (err) {
        return server_1.NextResponse.json({ success: false, error: err?.message || 'Failed to create session' }, { status: 500 });
    }
}
