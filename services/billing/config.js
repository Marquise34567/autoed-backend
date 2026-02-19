"use strict";
/**
 * Billing Configuration and Mode Helpers
 * Centralized billing mode checks and configuration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBillingConfig = getBillingConfig;
exports.isBillingEnabled = isBillingEnabled;
exports.isSoftMode = isSoftMode;
exports.isLiveMode = isLiveMode;
exports.getPlanPriceId = getPlanPriceId;
exports.isSubscriptionActive = isSubscriptionActive;
exports.getPlanMetadata = getPlanMetadata;
/**
 * Get current billing configuration from environment variables
 */
function getBillingConfig() {
    const mode = (process.env.BILLING_MODE || 'off').toLowerCase();
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
function isBillingEnabled() {
    const { mode } = getBillingConfig();
    return mode === 'soft' || mode === 'live';
}
/**
 * Check if we're in test/soft mode
 */
function isSoftMode() {
    const { mode } = getBillingConfig();
    return mode === 'soft';
}
/**
 * Check if we're in live production mode
 */
function isLiveMode() {
    const { mode } = getBillingConfig();
    return mode === 'live';
}
/**
 * Get plan price ID from environment
 */
function getPlanPriceId(plan) {
    const priceIds = {
        starter: process.env.STRIPE_PRICE_STARTER,
        creator: process.env.STRIPE_PRICE_CREATOR,
        studio: process.env.STRIPE_PRICE_STUDIO,
    };
    return priceIds[plan.toLowerCase()] || null;
}
/**
 * Check if a user has active billing status
 */
function isSubscriptionActive(status) {
    return status === 'active';
}
/**
 * Get plan metadata for Stripe checkout
 */
function getPlanMetadata(plan) {
    return {
        plan: plan.toLowerCase(),
        billing_mode: getBillingConfig().mode,
    };
}
