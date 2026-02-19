"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = exports.runtime = void 0;
exports.GET = GET;
const server_1 = require("next/server");
const headers_1 = require("next/headers");
const firebaseAdmin_1 = require("@/lib/firebaseAdmin");
exports.runtime = 'nodejs';
exports.dynamic = 'force-dynamic';
async function GET() {
    const cookieStore = await (0, headers_1.cookies)();
    const session = cookieStore.get('session')?.value;
    if (!session) {
        return server_1.NextResponse.json({ success: false, user: null }, { status: 200 });
    }
    try {
        const decoded = await firebaseAdmin_1.adminAuth.verifySessionCookie(session, true);
        return server_1.NextResponse.json({ success: true, user: decoded }, { status: 200 });
    }
    catch {
        return server_1.NextResponse.json({ success: false, user: null }, { status: 200 });
    }
}
