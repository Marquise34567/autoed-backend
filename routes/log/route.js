"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.POST = POST;
const server_1 = require("next/server");
const preferences_1 = require("@/lib/server/preferences");
exports.runtime = "nodejs";
async function POST(request) {
    try {
        const body = await request.json();
        const { creatorId, type, payload } = body;
        if (!creatorId || !type) {
            return server_1.NextResponse.json({ error: "Missing creatorId or type" }, { status: 400 });
        }
        const profile = (0, preferences_1.applyPreferenceEvent)({ creatorId, type, payload });
        return server_1.NextResponse.json({ ok: true, profile });
    }
    catch (error) {
        return server_1.NextResponse.json({ error: "Log event failed", details: String(error) }, { status: 500 });
    }
}
