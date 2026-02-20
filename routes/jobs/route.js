"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.POST = POST;
const server_1 = require("next/server");
const crypto_1 = require("crypto");
const jobs_1 = require("@/lib/jobs");
exports.runtime = "nodejs";
async function POST(request) {
    try {
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
            return server_1.NextResponse.json({ error: "Expected application/json" }, { status: 415 });
        }
        const body = await request.json();
        const storagePath = typeof body?.storagePath === "string" ? body.storagePath : (typeof body?.path === 'string' ? body.path : null);
        if (!storagePath) {
            return server_1.NextResponse.json({ error: "Missing storagePath" }, { status: 400 });
        }
        const downloadURL = typeof body?.downloadURL === 'string' ? body.downloadURL : null;
        // Construct gsUri internally using configured bucket
        const gsUri = process.env.FIREBASE_STORAGE_BUCKET ? `gs://${process.env.FIREBASE_STORAGE_BUCKET}/${storagePath}` : null;
        const jobId = (0, crypto_1.randomUUID)();
        // try to infer uid from storagePath (expect uploads/{uid}/... or {uid}/...)
        const parts = storagePath.split('/').filter(Boolean);
        const inferredUid = parts.length ? (parts[0] === 'uploads' && parts[1] ? parts[1] : parts[0]) : 'unknown';
        const job = await (0, jobs_1.createJob)({
            id: jobId,
            uid: inferredUid,
            overallProgress: 0,
            overallEtaSec: null,
            message: 'Created',
            createdAt: Date.now(),
            // Persist canonical storage info
            storagePath: storagePath,
            gsUri: gsUri,
            downloadURL: downloadURL || null,
            objectPathOriginal: storagePath,
            logs: [`Created job for ${storagePath}`],
        });
        // Log request start
        console.log('[jobs.POST] incoming', { jobId, storagePath });
        // Enqueue job for worker processing (do not process inline)
        try {
            // dynamic import to interop with JS-based queue module
            const qmod = await Promise.resolve().then(() => __importStar(require('../../../../services/worker/queue')));
            const enqueue = qmod.enqueue || (qmod.default && qmod.default.enqueue);
            if (typeof enqueue === 'function') {
                enqueue(jobId, { storagePath, gsUri, downloadURL });
            }
            else {
                console.warn('[jobs.POST] enqueue not available; job persisted and worker should pick it up');
            }
        }
        catch (e) {
            console.error('[jobs.POST] failed to enqueue', e);
            (0, jobs_1.appendJobLog)(jobId, `Failed to enqueue: ${e?.message || String(e)}`);
            // still return success because job is persisted
        }
        // Log just before responding to confirm non-blocking
        console.log('[jobs.POST] responding', { jobId });
        return server_1.NextResponse.json({ jobId: job.id });
    }
    catch (err) {
        console.error('API ERROR:', err);
        console.error('STACK:', err?.stack);
        return server_1.NextResponse.json({ ok: false, message: err?.message || 'Unknown error', stack: err?.stack || null }, { status: 500 });
    }
}
