"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminDb = exports.adminAuth = void 0;
exports.getFirestore = getFirestore;
exports.withTimeout = withTimeout;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
function getCredential() {
    // Support two modes: individual FIREBASE_* env vars or a single
    // FIREBASE_SERVICE_ACCOUNT_JSON containing the service account JSON.
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        try {
            const sa = typeof process.env.FIREBASE_SERVICE_ACCOUNT_JSON === 'string'
                ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
                : process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
            const projectId = sa.project_id || sa.projectId;
            const clientEmail = sa.client_email || sa.clientEmail;
            const privateKey = sa.private_key;
            if (!projectId || !clientEmail || !privateKey) {
                throw new Error('Service account JSON missing required fields');
            }
            return firebase_admin_1.default.credential.cert({ projectId, clientEmail, privateKey });
        }
        catch (err) {
            throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: ' + (err && err.message || err));
        }
    }

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
if (!firebase_admin_1.default.apps.length) {
    try {
        const credential = getCredential();
        firebase_admin_1.default.initializeApp({ credential });
    }
    catch (e) {
        console.error('[services/firebaseAdmin] Firebase initialization failed:', e && e.message ? e.message : e);
        throw e;
    }
}
exports.adminAuth = firebase_admin_1.default.auth();
exports.adminDb = firebase_admin_1.default.firestore();
exports.default = firebase_admin_1.default;
// Provide a helper to obtain Firestore instance (avoid accidental double-inits elsewhere)
function getFirestore() {
    return firebase_admin_1.default.firestore();
}
// Promise timeout helper to avoid Firestore calls hanging indefinitely
function withTimeout(p, ms = 10000) {
    let timer;
    const timeout = new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('Firestore operation timed out')), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
// Global process handlers to surface unhandled errors in logs
process.on('unhandledRejection', (err) => {
    console.error('[UNHANDLED_REJECTION]', err);
});
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT_EXCEPTION]', err);
});
