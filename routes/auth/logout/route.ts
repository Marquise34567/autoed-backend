/**
 * Logout API endpoint
 * POST /api/auth/logout
 * 
 * Uses Supabase Auth to sign out users
 * Clears session cookies
 */

import { createApiRouteClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Create Supabase client with proper response cookie handling
    const responseObj = NextResponse.json({ success: false })
    const { supabase, response } = await createApiRouteClient(responseObj)

    // Sign out with Supabase (clears session cookies)
    console.log('[api:auth:logout] Signing out user');
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('[api:auth:logout] Signout error:', error.message);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    console.log('[api:auth:logout] Logout successful');

    // Return success - cookies cleared
    const successResponse = NextResponse.json(
      { success: true },
      { status: 200 }
    );

    // Copy cookies (which now have cleared session cookies)
    response.cookies.getAll().forEach(({ name, value }) => {
      successResponse.cookies.set(name, value);
    });

    return successResponse;
  } catch (error) {
    console.error('[api:auth:logout] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Logout failed' },
      { status: 500 }
    );
  }
}
