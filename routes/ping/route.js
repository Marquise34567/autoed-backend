"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.GET = GET;
exports.runtime = "nodejs";
async function GET() {
    return Response.json({
        ok: true,
        ping: true,
        time: new Date().toISOString()
    });
}
