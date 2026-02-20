"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.GET = GET;
const server_1 = require("next/server");
const preferences_1 = require("@/lib/server/preferences");
exports.runtime = "nodejs";
async function GET(request) {
    const { searchParams } = new URL(request.url);
    const creatorId = searchParams.get("creatorId");
    if (!creatorId) {
        return server_1.NextResponse.json({ error: "Missing creatorId" }, { status: 400 });
    }
    const profile = (0, preferences_1.getPreferenceProfile)(creatorId);
    return server_1.NextResponse.json({ profile });
}
