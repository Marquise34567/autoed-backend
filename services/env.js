"use strict";
/**
 * Environment Variable Helpers
 *
 * Centralized, type-safe access to environment variables.
 * All values are read at module load time to ensure consistency.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPABASE_ANON_KEY = exports.SUPABASE_URL = exports.STRIPE_PUBLISHABLE_KEY = exports.APP_URL = exports.IS_DEV = exports.BILLING_LIVE = void 0;
/**
 * Check if billing is live in production.
 * BILLING_LIVE must be explicitly set to "true" (case-sensitive).
 *
 * This is a server-only variable - use only in API routes, server actions, or components.
 */
exports.BILLING_LIVE = process.env.BILLING_LIVE === "true";
/**
 * Check if we're in development mode.
 * Used to show dev-only UI elements and debug panels.
 */
exports.IS_DEV = process.env.NODE_ENV === "development";
/**
 * Get the app URL (for redirects and links).
 */
exports.APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
/**
 * Stripe public key (safe to expose to client).
 */
exports.STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
/**
 * Supabase URL (safe to expose to client).
 */
exports.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
/**
 * Supabase anon key (safe to expose to client).
 */
exports.SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
