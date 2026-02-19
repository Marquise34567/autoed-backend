"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = exports.runtime = void 0;
exports.POST = POST;
const server_1 = require("next/server");
const firebaseAdmin_1 = __importDefault(require("@/lib/firebaseAdmin"));
exports.runtime = 'nodejs';
exports.dynamic = 'force-dynamic';
/**
 * POST /api/video/download-session
 * Body: { jobId: string }
 * Authorization: Bearer <idToken>
 * Returns: { token: string }
 */
async function POST(req) {
    try {
        const authHeader = req.headers.get('authorization') || '';
        const match = authHeader.match(/^Bearer (.+)$/);
        if (!match)
            return server_1.NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
        const idToken = match[1];
        // Verify ID token
        let decoded;
        try {
            decoded = await firebaseAdmin_1.default.auth().verifyIdToken(idToken);
        }
        catch (e) {
            return server_1.NextResponse.json({ error: 'Invalid ID token' }, { status: 401 });
        }
        const uid = decoded.uid;
        if (!uid)
            return server_1.NextResponse.json({ error: 'Invalid token' }, { status: 401 });
        const body = await req.json().catch(() => ({}));
        const jobId = String(body?.jobId || '');
        if (!jobId)
            return server_1.NextResponse.json({ error: 'jobId is required' }, { status: 400 });
        const db = firebaseAdmin_1.default.firestore();
        // Try jobs/{jobId} first, then users/{uid}/jobs/{jobId}
        let jobRef = db.collection('jobs').doc(jobId);
        let jobSnap = await jobRef.get();
        if (!jobSnap.exists) {
            jobRef = db.collection('users').doc(uid).collection('jobs').doc(jobId);
            jobSnap = await jobRef.get();
        }
        if (!jobSnap.exists)
            return server_1.NextResponse.json({ error: 'Job not found' }, { status: 404 });
        const job = jobSnap.data();
        if (!job || job.uid !== uid)
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        const finalVideoPath = typeof job.finalVideoPath === 'string' && job.finalVideoPath
            ? job.finalVideoPath
            : (typeof job.objectPathOutput === 'string' ? job.objectPathOutput : '');
        if (!finalVideoPath)
            return server_1.NextResponse.json({ error: 'No finalVideoPath for job' }, { status: 400 });
        if (looksLikeUrl(finalVideoPath)) {
            return server_1.NextResponse.json({ error: 'Invalid finalVideoPath' }, { status: 400 });
        }
        if (!job.finalVideoPath && finalVideoPath) {
            try {
                await jobRef.set({
                    finalVideoPath,
                    objectPathOutput: firebaseAdmin_1.default.firestore.FieldValue.delete(),
                }, { merge: true });
            }
            catch (_) { }
        }
        // Create token and persist
        const token = cryptoRandom();
        const now = new Date();
        const expiresAt = firebaseAdmin_1.default.firestore.Timestamp.fromDate(new Date(now.getTime() + 10 * 60 * 1000)); // 10 minutes
        const tokenRef = db.collection('downloadTokens').doc(token);
        await tokenRef.set({
            uid,
            jobId,
            finalVideoPath,
            fileName: job.fileName || `autoeditor-${jobId}.mp4`,
            mimeType: job.mimeType || 'video/mp4',
            used: false,
            expiresAt,
            createdAt: firebaseAdmin_1.default.firestore.FieldValue.serverTimestamp(),
        });
        return server_1.NextResponse.json({ token });
    }
    catch (err) {
        console.error('[download-session] Error creating token', err);
        return server_1.NextResponse.json({ error: 'Failed to create download session' }, { status: 500 });
    }
}
function cryptoRandom() {
    try {
        // prefer crypto.randomUUID when available
        // @ts-ignore
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
            return crypto.randomUUID();
    }
    catch (e) { }
    const { randomBytes } = require('crypto');
    return randomBytes(16).toString('hex');
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
