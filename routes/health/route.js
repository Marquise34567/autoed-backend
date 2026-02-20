"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.GET = GET;
const server_1 = require("next/server");
exports.runtime = "nodejs";
async function GET() {
    return server_1.NextResponse.json({
        ok: true,
        timestamp: new Date().toISOString(),
        version: "1.0.0",
    });
}
