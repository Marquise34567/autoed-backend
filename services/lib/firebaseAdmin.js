"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminDb = exports.adminAuth = void 0;
exports.getBucket = getBucket;
exports.getBucketName = getBucketName;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
function getCredential() {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;
    const missing = [];
    if (!projectId)
        missing.push('FIREBASE_PROJECT_ID');
    if (!clientEmail)
        missing.push('FIREBASE_CLIENT_EMAIL');
    if (!privateKeyRaw)
        missing.push('FIREBASE_PRIVATE_KEY');
    if (missing.length) {
        throw new Error(`Missing required Firebase environment variables: ${missing.join(', ')}`);
    }
    const privateKey = String(privateKeyRaw).replace(/\\n/g, '\n');
    return firebase_admin_1.default.credential.cert({ projectId, clientEmail, privateKey });
}
// Derive bucket name: prefer explicit env, else <PROJECT_ID>.appspot.com
function getBucketName() {
    const envBucket = (process.env.FIREBASE_STORAGE_BUCKET || '').trim();
    if (envBucket)
        return envBucket.replace(/^gs:\/\//i, '');
    const pid = process.env.FIREBASE_PROJECT_ID;
    if (pid)
        return `${pid}.appspot.com`;
    return null;
}
if (!firebase_admin_1.default.apps.length) {
    try {
        const credential = getCredential();
        const storageBucket = getBucketName() || undefined;
        firebase_admin_1.default.initializeApp({ credential, storageBucket });
        if (storageBucket)
            console.log('[services/lib/firebaseAdmin] initialized with storageBucket:', storageBucket);
        else
            console.log('[services/lib/firebaseAdmin] initialized without storageBucket');
    }
    catch (e) {
        console.error('[services/lib/firebaseAdmin] Firebase initialization failed:', e && e.message ? e.message : e);
        throw e;
    }
}
exports.adminAuth = firebase_admin_1.default.auth();
exports.adminDb = firebase_admin_1.default.firestore();
// Helper to get a bucket instance. Prefer explicit name argument, then
// environment-derived bucket, then throw if none available.
function getBucket(name) {
    const bucketName = name || getBucketName();
    if (!bucketName)
        throw new Error('FIREBASE_STORAGE_BUCKET not configured and could not derive bucket name');
    return firebase_admin_1.default.storage().bucket(bucketName);
}
exports.default = firebase_admin_1.default;
