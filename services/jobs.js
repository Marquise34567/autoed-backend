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
exports.createJob = createJob;
exports.getJob = getJob;
exports.updateJob = updateJob;
exports.appendJobLog = appendJobLog;
exports.setJob = setJob;
const firebaseAdmin_1 = __importStar(require("./firebaseAdmin"));
const COLLECTION = 'jobs';
function now() {
    return Date.now();
}
async function createJob(job) {
    const db = (0, firebaseAdmin_1.getFirestore)();
    const docRef = db.collection(COLLECTION).doc(job.id);
    const finalVideoPath = typeof job.finalVideoPath === 'string' && job.finalVideoPath
        ? job.finalVideoPath
        : typeof job.objectPathOutput === 'string' && job.objectPathOutput
            ? job.objectPathOutput
            : null;
    const base = {
        // canonical fields expected by worker and front-end
        jobId: job.id,
        id: job.id,
        userId: job.uid || null,
        fileName: job.fileName || job.objectPathOriginal || null,
        inputPath: job.storagePath || job.objectPathOriginal || null,
        createdAt: job.createdAt || new Date(),
        updatedAt: job.updatedAt || new Date(),
        // REQUIRED FOR WORKER
        status: 'queued',
        phase: 'QUEUED',
        progress: {
            overallProgress: typeof job.overallProgress === 'number' ? job.overallProgress : 0,
            overallEtaSec: job.overallEtaSec ?? null,
        },
        heartbeat: {
            seq: 0,
            phase: 'QUEUED',
            workerLastSeenAt: null,
        },
        // compatibility / other fields
        objectPathNormalized: job.objectPathNormalized || null,
        finalVideoPath,
        resultUrl: null,
        error: null,
        logs: job.logs || [],
    };
    try {
        await (0, firebaseAdmin_1.withTimeout)(docRef.set(base), 10000);
        return base;
    }
    catch (err) {
        console.error('[FIRESTORE_ERROR]', {
            message: err?.message,
            code: err?.code,
            details: err?.details,
            stack: err?.stack,
            raw: err,
        });
        throw err;
    }
}
async function getJob(id) {
    const db = (0, firebaseAdmin_1.getFirestore)();
    const docRef = db.collection(COLLECTION).doc(id);
    let doc;
    try {
        doc = await (0, firebaseAdmin_1.withTimeout)(docRef.get(), 10000);
    }
    catch (err) {
        console.error('[FIRESTORE_ERROR]', {
            message: err?.message,
            code: err?.code,
            details: err?.details,
            stack: err?.stack,
            raw: err,
        });
        throw err;
    }
    if (!doc.exists)
        return null;
    const data = (doc.data() || {});
    const { job, cleanupPatch } = sanitizeJobRead(data);
    if (cleanupPatch) {
        try {
            await (0, firebaseAdmin_1.withTimeout)(docRef.set(cleanupPatch, { merge: true }), 8000);
        }
        catch (e) {
            console.warn('[FIRESTORE_CLEANUP_FAILED]', e && e.message ? e.message : e);
        }
    }
    // Attach signed URLs for client consumption (do not persist)
    try {
        const withUrls = await attachSignedUrlsToJob(job, 30);
        return withUrls;
    }
    catch (e) {
        console.warn('[ATTACH_URLS_FAILED]', e && e.message ? e.message : e);
        return job;
    }
}
async function attachSignedUrlsToJob(job, expiresMinutes = 30) {
    if (!job)
        return job;
    const cloned = { ...job };
    try {
        const bucket = firebaseAdmin_1.default.storage().bucket();
        // final video path -> videoUrl
        if (cloned.finalVideoPath) {
            try {
                const f = bucket.file(cloned.finalVideoPath);
                const [exists] = await f.exists();
                if (exists) {
                    const expires = new Date(Date.now() + (expiresMinutes || 30) * 60 * 1000);
                    const [url] = await f.getSignedUrl({ version: 'v4', action: 'read', expires });
                    cloned.videoUrl = url;
                }
            }
            catch (_) { }
        }
        // result.json guess
        try {
            const guess = `results/${cloned.id}/result.json`;
            const f2 = bucket.file(guess);
            const [exists2] = await f2.exists();
            if (exists2) {
                const expires = new Date(Date.now() + (expiresMinutes || 30) * 60 * 1000);
                const [url2] = await f2.getSignedUrl({ version: 'v4', action: 'read', expires });
                cloned.resultUrl = url2;
            }
        }
        catch (_) { }
        // resultUrls map
        if (cloned.resultUrls && typeof cloned.resultUrls === 'object') {
            const out = {};
            for (const k of Object.keys(cloned.resultUrls)) {
                const v = cloned.resultUrls[k];
                if (typeof v === 'string') {
                    try {
                        let path = null;
                        if (v.startsWith('results/') || v.startsWith('outputs/') || v.startsWith('uploads/'))
                            path = v;
                        else if (v.includes('storage.googleapis.com')) {
                            const m = v.match(/^https?:\/\/storage.googleapis.com\/(?:[^\/]+)\/(.+)$/i);
                            if (m)
                                path = m[1];
                        }
                        if (path) {
                            const f3 = bucket.file(path);
                            const [exists3] = await f3.exists();
                            if (exists3) {
                                const expires = new Date(Date.now() + (expiresMinutes || 30) * 60 * 1000);
                                const [u] = await f3.getSignedUrl({ version: 'v4', action: 'read', expires });
                                out[k] = u;
                                continue;
                            }
                        }
                    }
                    catch (_) { }
                }
                out[k] = v;
            }
            ;
            cloned.resultUrls = out;
        }
    }
    catch (e) {
        // ignore failures
    }
    return cloned;
}
async function updateJob(id, patch) {
    const db = (0, firebaseAdmin_1.getFirestore)();
    const docRef = db.collection(COLLECTION).doc(id);
    let snap;
    try {
        snap = await (0, firebaseAdmin_1.withTimeout)(docRef.get(), 10000);
    }
    catch (err) {
        console.error('[FIRESTORE_ERROR]', {
            message: err?.message,
            code: err?.code,
            details: err?.details,
            stack: err?.stack,
            raw: err,
        });
        throw err;
    }
    if (!snap.exists) {
        return null;
    }
    const current = snap.data() || {};
    const { job: cleanedCurrent, cleanupPatch } = sanitizeJobRead(current);
    const sanitized = sanitizeJobPatch(patch);
    const next = { ...cleanedCurrent, ...sanitized, updatedAt: now() };
    const writePayload = cleanupPatch ? { ...next, ...cleanupPatch } : next;
    try {
        await (0, firebaseAdmin_1.withTimeout)(docRef.set(writePayload, { merge: true }), 10000);
    }
    catch (err) {
        console.error('[FIRESTORE_ERROR]', {
            message: err?.message,
            code: err?.code,
            details: err?.details,
            stack: err?.stack,
            raw: err,
        });
        throw err;
    }
    return next;
}
async function appendJobLog(id, message) {
    const db = (0, firebaseAdmin_1.getFirestore)();
    const docRef = db.collection(COLLECTION).doc(id);
    let snap;
    try {
        snap = await (0, firebaseAdmin_1.withTimeout)(docRef.get(), 8000);
    }
    catch (err) {
        console.error('[FIRESTORE_ERROR]', {
            message: err?.message,
            code: err?.code,
            details: err?.details,
            stack: err?.stack,
            raw: err,
        });
        throw err;
    }
    const current = snap.exists ? (snap.data() || {}) : {};
    const logs = Array.isArray(current.logs) ? [...current.logs, message] : [message];
    const next = { ...current, logs, updatedAt: now() };
    try {
        await (0, firebaseAdmin_1.withTimeout)(docRef.set(next, { merge: true }), 10000);
    }
    catch (err) {
        console.error('[FIRESTORE_ERROR]', {
            message: err?.message,
            code: err?.code,
            details: err?.details,
            stack: err?.stack,
            raw: err,
        });
        throw err;
    }
    return next;
}
function sanitizeJobPatch(patch) {
    const next = { ...patch };
    // Never persist signed URLs or legacy download URL fields
    // Keep explicit `downloadURL` if caller included it — worker prefers it when present.
    // Prefer canonical finalVideoPath and avoid writing legacy objectPathOutput
    if (!next.finalVideoPath && typeof next.objectPathOutput === 'string') {
        next.finalVideoPath = next.objectPathOutput;
    }
    if ('objectPathOutput' in next)
        delete next.objectPathOutput;
    // Normalize progress: convert fractions (0..1) to 0..100 and clamp
    if (typeof next.progress !== 'undefined') {
        let p = Number(next.progress);
        if (Number.isFinite(p)) {
            // if fraction between 0 and 1, scale
            if (p > 0 && p <= 1)
                p = Math.round(p * 100);
            if (p < 0)
                p = 0;
            if (p > 100)
                p = 100(next).progress = Math.round(p);
        }
        else {
            delete next.progress;
        }
    }
    // Normalize error fields: prefer `errorMessage` as canonical field
    if (next.error && !next.errorMessage) {
        next.errorMessage = String(next.error);
        delete next.error;
    }
    return next;
}
function looksLikeUrl(value) {
    const v = value.trim();
    if (!v)
        return false;
    if (v.includes('?'))
        return true;
    return (v.includes('http://') ||
        v.includes('https://') ||
        v.includes('storage.googleapis.com') ||
        v.includes('GoogleAccessId=') ||
        v.includes('X-Goog-Algorithm') ||
        v.includes('X-Goog-Credential') ||
        v.includes('X-Goog-Signature'));
}
function sanitizeJobRead(job) {
    const next = { ...job };
    const cleanup = {};
    // Preserve any provided downloadURL/downloadUrl fields so the worker can use them.
    if (typeof next.objectPathOutput === 'string') {
        if (looksLikeUrl(next.objectPathOutput)) {
            delete next.objectPathOutput;
            cleanup.objectPathOutput = firebaseAdmin_1.default.firestore.FieldValue.delete();
        }
        else {
            if (!next.finalVideoPath) {
                next.finalVideoPath = next.objectPathOutput;
                cleanup.finalVideoPath = next.objectPathOutput;
            }
            delete next.objectPathOutput;
            cleanup.objectPathOutput = firebaseAdmin_1.default.firestore.FieldValue.delete();
        }
    }
    return { job: next, cleanupPatch: Object.keys(cleanup).length ? cleanup : null };
}
exports.default = {
    createJob,
    getJob,
    updateJob,
    appendJobLog,
};
// Backwards-compat: many modules call setJob — alias to updateJob
async function setJob(id, patch) {
    return updateJob(id, patch);
}
