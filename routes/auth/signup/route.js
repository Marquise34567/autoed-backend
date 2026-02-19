"use strict";
/**
 * Signup API endpoint
 * POST /api/auth/signup
 *
 * Uses Supabase Auth to register new users
 * Sends confirmation email and sets initial session
 */
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
exports.dynamic = exports.runtime = void 0;
exports.POST = POST;
const firebaseAdmin_1 = __importStar(require("@/lib/firebaseAdmin"));
const server_1 = require("next/server");
exports.runtime = 'nodejs';
exports.dynamic = 'force-dynamic';
async function POST(request) {
    try {
        const body = await request.json();
        const { email, password, confirmPassword } = body;
        // Validate input
        if (!email || !password || !confirmPassword) {
            return server_1.NextResponse.json({ success: false, error: 'Email and passwords required' }, { status: 400 });
        }
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return server_1.NextResponse.json({ success: false, error: 'Invalid email format' }, { status: 400 });
        }
        // Validate password length
        if (password.length < 6) {
            return server_1.NextResponse.json({ success: false, error: 'Password must be at least 6 characters' }, { status: 400 });
        }
        // Check passwords match
        if (password !== confirmPassword) {
            return server_1.NextResponse.json({ success: false, error: 'Passwords do not match' }, { status: 400 });
        }
        // Use Firebase REST API to create user and return session cookie
        const apiKey = process.env.FIREBASE_API_KEY;
        if (!apiKey) {
            console.error('[api:auth:signup] Missing FIREBASE_API_KEY');
            return server_1.NextResponse.json({ success: false, error: 'Server misconfiguration' }, { status: 500 });
        }
        if (!firebaseAdmin_1.isAdminInitialized) {
            console.error('[api:auth:signup] firebase-admin not initialized');
            return server_1.NextResponse.json({ success: false, error: 'Server misconfiguration' }, { status: 500 });
        }
        console.log('[api:auth:signup] Creating Firebase user:', email);
        const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true }),
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data) {
            const msg = data?.error?.message || resp.statusText || `HTTP ${resp.status}`;
            console.error('[api:auth:signup] Firebase sign-up failed:', msg);
            return server_1.NextResponse.json({ success: false, error: msg }, { status: 400 });
        }
        const idToken = data.idToken;
        if (!idToken) {
            console.error('[api:auth:signup] No idToken returned from Firebase');
            return server_1.NextResponse.json({ success: false, error: 'Authentication failed' }, { status: 500 });
        }
        // Create session cookie using firebase-admin
        if (!firebaseAdmin_1.default || !firebaseAdmin_1.default.auth) {
            console.error('[api:auth:signup] firebase-admin not initialized');
            return server_1.NextResponse.json({ success: false, error: 'Server misconfiguration' }, { status: 500 });
        }
        const expiresIn = 5 * 24 * 60 * 60 * 1000;
        const sessionCookie = await firebaseAdmin_1.default.auth().createSessionCookie(idToken, { expiresIn });
        const res = server_1.NextResponse.json({ success: true, user: { uid: data.localId || data.userId || null, email: data.email } }, { status: 201 });
        res.cookies.set('session', sessionCookie, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: expiresIn / 1000,
        });
        return res;
    }
    catch (error) {
        console.error('[api:auth:signup] Error:', error);
        return server_1.NextResponse.json({ success: false, error: 'Signup failed' }, { status: 500 });
    }
}
