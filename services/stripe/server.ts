/**
 * Server-side Stripe Helper
 * 
 * Provides runtime-only Stripe initialization to prevent build-time errors
 * when STRIPE_SECRET_KEY is not available (e.g., in Vercel build environment).
 * 
 * IMPORTANT: Always use getStripe() instead of initializing Stripe at module level.
 */

import Stripe from 'stripe';

// Safe, runtime-only Stripe initialization — only when key looks valid
const stripeKey = process.env.STRIPE_SECRET_KEY;
let stripe: Stripe | null = null;
if (stripeKey && stripeKey.startsWith('sk_')) {
  try {
    stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });
    console.log('✅ Stripe initialized');
  } catch (e) {
    console.warn('⚠️ Failed to initialize Stripe:', e);
    stripe = null;
  }
} else {
  console.warn('⚠️ STRIPE_SECRET_KEY missing/invalid — billing disabled.');
}

let stripeInstance: Stripe | null = stripe;

/**
 * Require an environment variable at runtime
 * 
 * @throws {Error} If the variable is missing or empty
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not configured. ` +
      `Add it to your environment variables: ${name}=...`
    );
  }
  return value;
}

/**
 * Get or create a Stripe instance
 * 
 * This function ensures Stripe is only initialized at runtime, not during build.
 * It validates the API key and throws a helpful error if missing.
 * 
 * @throws {Error} If STRIPE_SECRET_KEY is not configured
 * @returns {Stripe} Configured Stripe instance
 */
export function getStripe(): Stripe {
  if (stripeInstance) return stripeInstance;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey || !apiKey.startsWith('sk_')) {
    throw new Error('STRIPE_SECRET_KEY is not configured or invalid');
  }
  stripeInstance = new Stripe(apiKey, { apiVersion: '2024-06-20' });
  return stripeInstance;
}

/**
 * Check if Stripe is properly configured
 * 
 * Use this for graceful degradation in routes that should return
 * a user-friendly error instead of crashing.
 * 
 * @returns {boolean} True if STRIPE_SECRET_KEY is configured
 */
export function isStripeConfigured(): boolean {
  return !!(stripe);
}

export { stripe };
