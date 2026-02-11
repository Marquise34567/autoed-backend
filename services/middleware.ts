import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { assertServerEnv } from '@/lib/env/assert'
import { createApiRouteClient } from '@/lib/supabase/server'

// Fail fast in middleware if envs missing
assertServerEnv()

// Define protected routes and their required plans
const PROTECTED_ROUTES = {
  '/editor': ['creator', 'studio'],
  '/generate': ['creator', 'studio'],
  '/dashboard': null, // accessible to all authenticated users
}

export async function middleware(request: NextRequest) {
  // BYPASS: Disable middleware in development if Supabase not configured
  const isDev = process.env.NODE_ENV === 'development'
  const supabaseConfigured = process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('supabase.co')
  
  if (isDev && !supabaseConfigured) {
    console.log('[middleware] Bypassed - Supabase not configured')
    return NextResponse.next()
  }

  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // Bypass API routes and static assets
  const pathname = request.nextUrl.pathname
  if (pathname.startsWith('/api/')) return NextResponse.next()

  // Create Supabase server client that will set cookies on `response`
  const { supabase, response: supaResponse } = await createApiRouteClient(response)

  // Get user session from Supabase
  const {
    data: { user },
  } = await supabase.auth.getUser()

  console.log('[middleware] user present for', pathname, !!user)

  // Check if route requires authentication
  const protectedRoute = Object.keys(PROTECTED_ROUTES).find((route) =>
    pathname.startsWith(route)
  )

  if (protectedRoute) {
    // Redirect to login if not authenticated
    if (!user) {
      const loginUrl = new URL('/login', request.url)
      // Use `next` param so the login page can redirect back after auth
      loginUrl.searchParams.set('next', pathname)
      console.log('[middleware] redirecting unauthenticated to', loginUrl.toString())
      return supaResponse
        ? supaResponse.redirect(loginUrl)
        : NextResponse.redirect(loginUrl)
    }

    // Check plan requirements (if any)
    const requiredPlans = PROTECTED_ROUTES[protectedRoute as keyof typeof PROTECTED_ROUTES]
    
    if (requiredPlans) {
      // Create Supabase server client (used only for billing queries)
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return request.cookies.getAll()
            },
            setAll(cookiesToSet) {
              cookiesToSet.forEach(({ name, value }) =>
                request.cookies.set(name, value)
              )
              cookiesToSet.forEach(({ name, value, options }) =>
                response.cookies.set(name, value, options)
              )
            },
          },
        }
      )

      // Query billing status (requires authenticated user)
      const { data: billingData } = await supabase
        .from('billing_status')
        .select('plan, status')
        .eq('user_id', user?.id)
        .single()

      // Block if no active subscription or wrong plan
      if (
        !billingData ||
        billingData.status !== 'active' ||
        !requiredPlans.includes(billingData.plan)
      ) {
        const pricingUrl = new URL('/pricing', request.url)
        pricingUrl.searchParams.set('locked', protectedRoute.slice(1))
        pricingUrl.searchParams.set('required', requiredPlans[0])
        return NextResponse.redirect(pricingUrl)
      }
    }
  }
  
  // If authenticated but hitting /login, redirect to next or editor
  if (pathname.startsWith('/login') && user) {
    const loginUrl = new URL(request.url)
    const next = loginUrl.searchParams.get('next') || '/editor'
    console.log('[middleware] authenticated user accessing /login — redirecting to', next)
    const dest = new URL(next, request.url)
    return supaResponse ? supaResponse.redirect(dest) : NextResponse.redirect(dest)
  }

  // Return the mutated Supabase response so cookie updates persist
  return supaResponse || response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
