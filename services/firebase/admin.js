"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAdminInitialized = void 0;
exports.getAdminAuth = getAdminAuth;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
function requireEnv(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env var: ${name}`);
    return v;
}
// Initialize firebase-admin once and fail loudly if misconfigured
let initialized = false;
try {
    const projectId = requireEnv('FIREBASE_PROJECT_ID');
    const clientEmail = requireEnv('FIREBASE_CLIENT_EMAIL');
    let privateKey = requireEnv('FIREBASE_PRIVATE_KEY');
    // Private key in env should contain literal \n sequences; convert to real newlines
    privateKey = privateKey.replace(/\\n/g, '\n');
    // Avoid double initialization
    const apps = firebase_admin_1.default.apps || [];
    if (apps.length === 0) {
        firebase_admin_1.default.initializeApp({
            credential: firebase_admin_1.default.credential.cert({
                projectId,
                clientEmail,
                privateKey,
            }),
        });
    }
    initialized = true;
    console.log('[firebase:admin] Initialized');
}
catch (e) {
    // Fail loudly on server start in dev to help debugging
    console.error('[firebase:admin] Initialization error:', e instanceof Error ? e.message : e);
}
function getAdminAuth() {
    if (!initialized)
        throw new Error('firebase-admin not initialized. Check FIREBASE_* env vars');
    return firebase_admin_1.default.auth();
}
exports.isAdminInitialized = initialized;
exports.default = firebase_admin_1.default;
