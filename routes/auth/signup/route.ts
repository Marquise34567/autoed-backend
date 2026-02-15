/**
 * Signup API endpoint
 * POST /api/auth/signup
 * 
 * Uses Supabase Auth to register new users
 * Sends confirmation email and sets initial session
 */

import admin, { isAdminInitialized } from '@/lib/firebaseAdmin';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, confirmPassword } = body;

    // Validate input
    if (!email || !password || !confirmPassword) {
      return NextResponse.json(
        { success: false, error: 'Email and passwords required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Validate password length
    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    // Check passwords match
    if (password !== confirmPassword) {
      return NextResponse.json(
        { success: false, error: 'Passwords do not match' },
        { status: 400 }
      );
    }

    // Use Firebase REST API to create user and return session cookie
    const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey) {
      console.error('[api:auth:signup] Missing FIREBASE_API_KEY');
      return NextResponse.json({ success: false, error: 'Server misconfiguration' }, { status: 500 });
    }

    if (!isAdminInitialized) {
      console.error('[api:auth:signup] firebase-admin not initialized');
      return NextResponse.json({ success: false, error: 'Server misconfiguration' }, { status: 500 });
    }

    console.log('[api:auth:signup] Creating Firebase user:', email);
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );

    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data) {
      const msg = data?.error?.message || resp.statusText || `HTTP ${resp.status}`;
      console.error('[api:auth:signup] Firebase sign-up failed:', msg);
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }

    const idToken = data.idToken;
    if (!idToken) {
      console.error('[api:auth:signup] No idToken returned from Firebase');
      return NextResponse.json({ success: false, error: 'Authentication failed' }, { status: 500 });
    }

    // Create session cookie using firebase-admin
    if (!admin || !admin.auth) {
      console.error('[api:auth:signup] firebase-admin not initialized');
      return NextResponse.json({ success: false, error: 'Server misconfiguration' }, { status: 500 });
    }

    const expiresIn = 5 * 24 * 60 * 60 * 1000;
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });

    const res = NextResponse.json(
      { success: true, user: { uid: data.localId || data.userId || null, email: data.email } },
      { status: 201 }
    );

    res.cookies.set('session', sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: expiresIn / 1000,
    });

    return res;
  } catch (error) {
    console.error('[api:auth:signup] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Signup failed' },
      { status: 500 }
    );
  }
}
