/**
 * Billing Configuration and Mode Helpers
 * Centralized billing mode checks and configuration
 */

export type BillingMode = 'off' | 'soft' | 'live';

export interface BillingConfig {
  mode: BillingMode;
  testAutoActivate: boolean;
  testAllowManualActivate: boolean;
  adminKey: string | undefined;
}

/**
 * Get current billing configuration from environment variables
 */
export function getBillingConfig(): BillingConfig {
  const mode = (process.env.BILLING_MODE || 'off').toLowerCase() as BillingMode;
  
  // Validate mode
  if (!['off', 'soft', 'live'].includes(mode)) {
    console.warn(`[billing] Invalid BILLING_MODE: ${mode}, defaulting to 'off'`);
    return {
      mode: 'off',
      testAutoActivate: false,
      testAllowManualActivate: false,
      adminKey: undefined,
    };
  }

  return {
    mode,
    testAutoActivate: process.env.BILLING_TEST_AUTOACTIVATE === 'true',
    testAllowManualActivate: process.env.BILLING_TEST_ALLOW_MANUAL_ACTIVATE === 'true',
    adminKey: process.env.BILLING_ADMIN_KEY,
  };
}

/**
 * Check if billing is enabled (soft or live mode)
 */
export function isBillingEnabled(): boolean {
  const { mode } = getBillingConfig();
  return mode === 'soft' || mode === 'live';
}

/**
 * Check if we're in test/soft mode
 */
export function isSoftMode(): boolean {
  const { mode } = getBillingConfig();
  return mode === 'soft';
}

/**
 * Check if we're in live production mode
 */
export function isLiveMode(): boolean {
  const { mode } = getBillingConfig();
  return mode === 'live';
}

/**
 * Get plan price ID from environment
 */
export function getPlanPriceId(plan: string): string | null {
  const priceIds: Record<string, string | undefined> = {
    starter: process.env.STRIPE_PRICE_STARTER,
    creator: process.env.STRIPE_PRICE_CREATOR,
    studio: process.env.STRIPE_PRICE_STUDIO,
  };

  return priceIds[plan.toLowerCase()] || null;
}

/**
 * Check if a user has active billing status
 */
export function isSubscriptionActive(status: string | null): boolean {
  return status === 'active';
}

/**
 * Get plan metadata for Stripe checkout
 */
export function getPlanMetadata(plan: string): Record<string, string> {
  return {
    plan: plan.toLowerCase(),
    billing_mode: getBillingConfig().mode,
  };
}
