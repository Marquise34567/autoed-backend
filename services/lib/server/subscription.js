"use strict";
/**
 * User Subscription Model & Database
 *
 * Server-side single source of truth for subscription status.
 * Now backed by Supabase PostgreSQL.
 *
 * Key principle: Subscription status comes from provider (Stripe),
 * never from client-side or local flags.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserSubscription = getUserSubscription;
exports.updateUserSubscription = updateUserSubscription;
exports.isBillingLive = isBillingLive;
exports.getUserEntitlements = getUserEntitlements;
exports.incrementRenderUsage = incrementRenderUsage;
exports.getDemoUserId = getDemoUserId;
exports.isSubscriptionActive = isSubscriptionActive;
const db_1 = require("@/lib/supabase/db");
/**
 * Get or create default Free subscription for a user.
 */
function getDefaultSubscription(userId) {
    const now = Math.floor(Date.now() / 1000);
    return {
        userId,
        planId: "free",
        provider: "none",
        status: "free",
        currentPeriodStart: now,
        currentPeriodEnd: now + 30 * 24 * 60 * 60, // 30 days
        rendersUsedThisPeriod: 0,
        updatedAt: now,
    };
}
/**
 * Convert Supabase subscription to UserSubscription format
 */
function dbSubscriptionToUserSubscription(dbSub) {
    return {
        userId: dbSub.user_id,
        planId: (dbSub.plan_id || "free"),
        provider: dbSub.stripe_customer_id ? "stripe" : "none",
        providerCustomerId: dbSub.stripe_customer_id || undefined,
        providerSubscriptionId: dbSub.stripe_subscription_id || undefined,
        status: (dbSub.status || "free"),
        currentPeriodStart: Math.floor(new Date(dbSub.current_period_start || Date.now()).getTime() / 1000),
        currentPeriodEnd: Math.floor(new Date(dbSub.current_period_end || Date.now()).getTime() / 1000),
        rendersUsedThisPeriod: 0, // Will be fetched separately from usage_monthly
        updatedAt: Math.floor(new Date(dbSub.updated_at || Date.now()).getTime() / 1000),
    };
}
/**
 * Get monthly render count for the current period
 */
async function getRendersUsedThisMonth(userId, monthKey) {
    try {
        const usage = await (0, db_1.getMonthlyUsage)(userId, monthKey);
        return usage?.renders_used || 0;
    }
    catch (error) {
        console.error("[subscription] Error getting usage:", error);
        return 0;
    }
}
/**
 * Get current month key (YYYY-MM format)
 */
function getCurrentMonthKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
}
/**
 * Get user subscription from Supabase.
 * Returns Free plan if user not found.
 */
async function getUserSubscription(userId) {
    try {
        const dbSub = await (0, db_1.getUserSubscription)(userId);
        if (!dbSub) {
            // Return default free subscription
            return getDefaultSubscription(userId);
        }
        const monthKey = getCurrentMonthKey();
        const rendersUsed = await getRendersUsedThisMonth(userId, monthKey);
        const subscription = dbSubscriptionToUserSubscription(dbSub);
        subscription.rendersUsedThisPeriod = rendersUsed;
        return subscription;
    }
    catch (error) {
        console.error("[getUserSubscription] Failed:", error);
        return getDefaultSubscription(userId);
    }
}
/**
 * Update user subscription.
 * Called by Stripe webhook handler.
 */
async function updateUserSubscription(userId, updates) {
    try {
        // Convert UserSubscription format to Supabase format
        const dbUpdates = {};
        if (updates.planId)
            dbUpdates.plan_id = updates.planId;
        if (updates.status)
            dbUpdates.status = updates.status;
        if (updates.providerCustomerId)
            dbUpdates.stripe_customer_id = updates.providerCustomerId;
        if (updates.providerSubscriptionId)
            dbUpdates.stripe_subscription_id = updates.providerSubscriptionId;
        if (updates.currentPeriodStart) {
            dbUpdates.current_period_start = new Date(updates.currentPeriodStart * 1000).toISOString();
        }
        if (updates.currentPeriodEnd) {
            dbUpdates.current_period_end = new Date(updates.currentPeriodEnd * 1000).toISOString();
        }
        const dbSub = await (0, db_1.updateUserSubscription)(userId, dbUpdates);
        if (!dbSub) {
            throw new Error("Failed to update subscription");
        }
        const subscription = dbSubscriptionToUserSubscription(dbSub);
        // Get current month's render usage
        const monthKey = getCurrentMonthKey();
        subscription.rendersUsedThisPeriod = await getRendersUsedThisMonth(userId, monthKey);
        return subscription;
    }
    catch (error) {
        console.error("[subscription] Error updating subscription:", error);
        throw error;
    }
}
/**
 * Check if billing is live (server-side only).
 * Returns true only if BILLING_LIVE is explicitly set to "true".
 */
function isBillingLive() {
    return process.env.BILLING_LIVE === "true";
}
/**
 * Get user entitlements based on subscription.
 *
/**
 * ENTITLEMENTS (What features does this user have?)
 * Query the database to determine what the user can do
 * ALWAYS returns either a valid plan or FREE (never throws)
 *
 * This is the ONLY source of truth for feature access.
 *
 * In production with real Stripe:
 * - Subscriptions are activated by webhooks
 * - Inactive/free subscriptions automatically downgrade to FREE plan
 * - Features are locked by Stripe status, not by environment flags
 */
async function getUserEntitlements(userId) {
    // Get subscription from database
    const subscription = await getUserSubscription(userId);
    // If subscription is not active, downgrade to FREE
    if (!isSubscriptionActive(subscription) || subscription.planId === "free") {
        return {
            planId: "free",
            rendersPerMonth: 10,
            maxVideoLengthMinutes: 5,
            exportQuality: "720p",
            hasWatermark: true,
            queuePriority: "standard",
            canExportWithoutWatermark: false,
        };
    }
    // Return entitlements based on actual plan
    switch (subscription.planId) {
        case "starter":
            return {
                planId: "starter",
                rendersPerMonth: 50,
                maxVideoLengthMinutes: 15,
                exportQuality: "1080p",
                hasWatermark: false,
                queuePriority: "standard",
                canExportWithoutWatermark: true,
            };
        case "creator":
            return {
                planId: "creator",
                rendersPerMonth: 200,
                maxVideoLengthMinutes: 30,
                exportQuality: "4k",
                hasWatermark: false,
                queuePriority: "priority",
                canExportWithoutWatermark: true,
            };
        case "studio":
            return {
                planId: "studio",
                rendersPerMonth: 999999, // Unlimited
                maxVideoLengthMinutes: 120,
                exportQuality: "4k",
                hasWatermark: false,
                queuePriority: "ultra",
                canExportWithoutWatermark: true,
            };
        default:
            // Fallback to FREE
            return {
                planId: "free",
                rendersPerMonth: 10,
                maxVideoLengthMinutes: 5,
                exportQuality: "720p",
                hasWatermark: true,
                queuePriority: "standard",
                canExportWithoutWatermark: false,
            };
    }
}
/**
 * Increment render usage for current period.
 * Only called after successful render completion.
 * Uses atomic database operation.
 */
async function incrementRenderUsage(userId) {
    try {
        const monthKey = getCurrentMonthKey();
        return await (0, db_1.incrementRenderUsage)(userId, monthKey);
    }
    catch (error) {
        console.error("[subscription] Error incrementing usage:", error);
        return false;
    }
}
/**
 * Get demo user ID (for testing without real auth).
 * TODO: Replace with real authenticated user ID from session/token.
 */
function getDemoUserId() {
    return "demo-user-default";
}
/**
 * Helper: Check if subscription is active (unlocked).
 * "free" status means free tier, "active" means paid/trialing.
 */
function isSubscriptionActive(subscription) {
    return subscription.status === "active" || subscription.status === "pending_activation";
}
