"use strict";
/**
 * Stripe Configuration
 *
 * Centralized Stripe price lookup keys.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRIPE_PRICE_LOOKUPS = void 0;
exports.getAppUrl = getAppUrl;
exports.areWebhooksLive = areWebhooksLive;
/**
 * Stripe Price Lookup Keys
 * These must match the lookup_key values you set in Stripe Dashboard.
 */
exports.STRIPE_PRICE_LOOKUPS = {
    starter: process.env.STRIPE_STARTER_PRICE_LOOKUP || 'starter_monthly',
    creator: process.env.STRIPE_CREATOR_PRICE_LOOKUP || 'creator_monthly',
    studio: process.env.STRIPE_STUDIO_PRICE_LOOKUP || 'studio_monthly',
};
/**
 * Get app URL for redirect URLs
 */
function getAppUrl() {
    return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
}
/**
 * Check if webhooks are enabled
 */
function areWebhooksLive() {
    return process.env.BILLING_WEBHOOKS_LIVE === 'true';
}
