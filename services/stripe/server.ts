/**
 * Server-side Stripe Helper
 * 
 * Provides runtime-only Stripe initialization to prevent build-time errors
 * when STRIPE_SECRET_KEY is not available (e.g., in Vercel build environment).
 * 
 * IMPORTANT: Always use getStripe() instead of initializing Stripe at module level.
 */

import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

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
  // Return cached instance if available
  if (stripeInstance) {
    return stripeInstance;
  }

  // Validate API key
  const apiKey = requireEnv('STRIPE_SECRET_KEY');

  // Ensure we have a real key, not a placeholder
  if (apiKey === 'sk_test_missing_key' || apiKey.length < 20) {
    throw new Error(
      'STRIPE_SECRET_KEY appears to be invalid. ' +
      'Please provide a valid Stripe secret key from your dashboard.'
    );
  }

  // Create and cache the Stripe instance
  stripeInstance = new Stripe(apiKey, {
    apiVersion: '2026-01-28.clover',
    typescript: true,
  });

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
  const apiKey = process.env.STRIPE_SECRET_KEY;
  return !!(apiKey && apiKey !== 'sk_test_missing_key' && apiKey.length >= 20);
}
