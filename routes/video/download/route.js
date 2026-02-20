"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = exports.runtime = void 0;
exports.POST = POST;
const server_1 = require("next/server");
const authServer_1 = require("@/lib/authServer");
const jobs_1 = require("@/lib/jobs");
const firebaseAdmin_1 = require("@/lib/firebaseAdmin");
exports.runtime = "nodejs";
exports.dynamic = "force-dynamic";
const SIGNED_URL_TTL_MS = 10 * 60 * 1000; // 10 minutes
const URL_MARKERS = [
    "http://",
    "https://",
    "storage.googleapis.com",
    "GoogleAccessId=",
    "X-Goog-Algorithm",
    "X-Goog-Credential",
    "X-Goog-Signature",
];
function looksLikeUrl(value) {
    const v = value.trim();
    if (!v)
        return false;
    if (v.includes("?"))
        return true;
    return URL_MARKERS.some((m) => v.includes(m));
}
function normalizeStoragePath(raw) {
    if (typeof raw !== "string")
        return null;
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    if (trimmed.startsWith("gs://")) {
        return trimmed.replace(/^gs:\/\/[^/]+\//, "");
    }
    return trimmed;
}
function extractUidFromPath(path) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2)
        return null;
    if (parts[0] === "outputs" && parts[1] === "uploads" && parts.length >= 3) {
        return parts[2] || null;
    }
    if (parts[0] === "outputs" && parts.length >= 2) {
        return parts[1] || null;
    }
    return null;
}
async function POST(request) {
    try {
        const { uid } = await (0, authServer_1.requireAuth)(request);
        let body = null;
        try {
            body = await request.json();
        }
        catch (_) {
            body = null;
        }
        const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
        if (!jobId) {
            return server_1.NextResponse.json({ error: "Missing jobId" }, { status: 400 });
        }
        const job = await (0, jobs_1.getJob)(jobId);
        if (!job) {
            return server_1.NextResponse.json({ error: "Job not found" }, { status: 404 });
        }
        const finalVideoPath = normalizeStoragePath(job.finalVideoPath) ||
            normalizeStoragePath(job.objectPathOutput);
        if (!finalVideoPath) {
            return server_1.NextResponse.json({ error: "Video not ready" }, { status: 409 });
        }
        if (looksLikeUrl(finalVideoPath)) {
            return server_1.NextResponse.json({ error: "Invalid storage path" }, { status: 400 });
        }
        const ownerFromPath = extractUidFromPath(finalVideoPath);
        if (job.uid && job.uid !== uid) {
            return server_1.NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        if (!job.uid && ownerFromPath && ownerFromPath !== uid) {
            return server_1.NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        if (!job.uid && !ownerFromPath) {
            return server_1.NextResponse.json({ error: "Unable to verify ownership" }, { status: 403 });
        }
        let bucket;
        try {
            bucket = (0, firebaseAdmin_1.getBucket)();
        }
        catch (e) {
            return server_1.NextResponse.json({ ok: false, error: 'FIREBASE_STORAGE_BUCKET missing' }, { status: 500 });
        }
        const file = bucket.file(finalVideoPath);
        const [exists] = await file.exists();
        if (!exists) {
            return server_1.NextResponse.json({ error: "File not found" }, { status: 404 });
        }
        // Signed URLs are disabled. Return the storage path so clients can use the
        // Firebase client SDK to download the file directly from Storage.
        const response = server_1.NextResponse.json({ storagePath: finalVideoPath }, { status: 200 });
        response.headers.set("Cache-Control", "no-store");
        return response;
    }
    catch (err) {
        if (err instanceof Response)
            return err;
        return server_1.NextResponse.json({ error: "Failed to generate download URL", details: err?.message || String(err) }, { status: 500 });
    }
}
