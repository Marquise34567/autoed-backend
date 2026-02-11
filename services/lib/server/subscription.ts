/**
 * User Subscription Model & Database
 * 
 * Server-side single source of truth for subscription status.
 * Now backed by Supabase PostgreSQL.
 * 
 * Key principle: Subscription status comes from provider (Stripe),
 * never from client-side or local flags.
 */

import type { PlanId } from "@/config/plans";
import {
  getUserSubscription as dbGetUserSubscription,
  updateUserSubscription as dbUpdateUserSubscription,
  incrementRenderUsage as dbIncrementRenderUsage,
  updateSubscriptionByStripeCustomerId,
  getMonthlyUsage,
} from "@/lib/supabase/db";

export type SubscriptionStatus = "free" | "active" | "pending_activation" | "past_due" | "canceled";

export interface UserSubscription {
  /** User ID (from auth system) */
  userId: string;
  /** Current plan: "free" | "starter" | "creator" | "studio" */
  planId: PlanId;
  /** Payment provider: "stripe" | "none" (none = Free-only) */
  provider: "stripe" | "none";
  /** Provider customer ID (for Stripe: cus_xxx) */
  providerCustomerId?: string;
  /** Provider subscription ID (for Stripe: sub_xxx) */
  providerSubscriptionId?: string;
  /** Subscription status from provider */
  status: SubscriptionStatus;
  /** Unix timestamp: start of current billing period */
  currentPeriodStart: number;
  /** Unix timestamp: end of current billing period */
  currentPeriodEnd: number;
  /** Number of renders used in current period */
  rendersUsedThisPeriod: number;
  /** Last update timestamp */
  updatedAt: number;
}

/**
 * Get or create default Free subscription for a user.
 */
function getDefaultSubscription(userId: string): UserSubscription {
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
function dbSubscriptionToUserSubscription(dbSub: any): UserSubscription {
  return {
    userId: dbSub.user_id,
    planId: (dbSub.plan_id || "free") as PlanId,
    provider: dbSub.stripe_customer_id ? "stripe" : "none",
    providerCustomerId: dbSub.stripe_customer_id || undefined,
    providerSubscriptionId: dbSub.stripe_subscription_id || undefined,
    status: (dbSub.status || "free") as SubscriptionStatus,
    currentPeriodStart: Math.floor(new Date(dbSub.current_period_start || Date.now()).getTime() / 1000),
    currentPeriodEnd: Math.floor(new Date(dbSub.current_period_end || Date.now()).getTime() / 1000),
    rendersUsedThisPeriod: 0, // Will be fetched separately from usage_monthly
    updatedAt: Math.floor(new Date(dbSub.updated_at || Date.now()).getTime() / 1000),
  };
}

/**
 * Get monthly render count for the current period
 */
async function getRendersUsedThisMonth(userId: string, monthKey: string): Promise<number> {
  try {
    const usage = await getMonthlyUsage(userId, monthKey);
    return usage?.renders_used || 0;
  } catch (error) {
    console.error("[subscription] Error getting usage:", error);
    return 0;
  }
}

/**
 * Get current month key (YYYY-MM format)
 */
function getCurrentMonthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Get user subscription from Supabase.
 * Returns Free plan if user not found.
 */
export async function getUserSubscription(userId: string): Promise<UserSubscription> {
  try {
    const dbSub = await dbGetUserSubscription(userId);
    
    if (!dbSub) {
      // Return default free subscription
      return getDefaultSubscription(userId);
    }

    const monthKey = getCurrentMonthKey();
    const rendersUsed = await getRendersUsedThisMonth(userId, monthKey);

    const subscription = dbSubscriptionToUserSubscription(dbSub);
    subscription.rendersUsedThisPeriod = rendersUsed;
    
    return subscription;
  } catch (error) {
    console.error("[getUserSubscription] Failed:", error);
    return getDefaultSubscription(userId);
  }
}


/**
 * Update user subscription.
 * Called by Stripe webhook handler.
 */
export async function updateUserSubscription(
  userId: string,
  updates: Partial<UserSubscription>
): Promise<UserSubscription> {
  try {
    // Convert UserSubscription format to Supabase format
    const dbUpdates: any = {};
    if (updates.planId) dbUpdates.plan_id = updates.planId;
    if (updates.status) dbUpdates.status = updates.status;
    if (updates.providerCustomerId) dbUpdates.stripe_customer_id = updates.providerCustomerId;
    if (updates.providerSubscriptionId) dbUpdates.stripe_subscription_id = updates.providerSubscriptionId;
    if (updates.currentPeriodStart) {
      dbUpdates.current_period_start = new Date(updates.currentPeriodStart * 1000).toISOString();
    }
    if (updates.currentPeriodEnd) {
      dbUpdates.current_period_end = new Date(updates.currentPeriodEnd * 1000).toISOString();
    }

    const dbSub = await dbUpdateUserSubscription(userId, dbUpdates);
    
    if (!dbSub) {
      throw new Error("Failed to update subscription");
    }

    const subscription = dbSubscriptionToUserSubscription(dbSub);
    
    // Get current month's render usage
    const monthKey = getCurrentMonthKey();
    subscription.rendersUsedThisPeriod = await getRendersUsedThisMonth(userId, monthKey);

    return subscription;
  } catch (error) {
    console.error("[subscription] Error updating subscription:", error);
    throw error;
  }
}

/**
 * Check if billing is live (server-side only).
 * Returns true only if BILLING_LIVE is explicitly set to "true".
 */
export function isBillingLive(): boolean {
  return process.env.BILLING_LIVE === "true";
}

/**
 * Plan Entitlements - What features does this plan allow?
 */
export interface PlanEntitlements {
  planId: PlanId;
  rendersPerMonth: number;
  maxVideoLengthMinutes: number;
  exportQuality: "720p" | "1080p" | "4k";
  hasWatermark: boolean;
  queuePriority: "standard" | "priority" | "ultra";
  canExportWithoutWatermark: boolean;
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
export async function getUserEntitlements(userId: string): Promise<PlanEntitlements> {
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
export async function incrementRenderUsage(userId: string): Promise<boolean> {
  try {
    const monthKey = getCurrentMonthKey();
    return await dbIncrementRenderUsage(userId, monthKey);
  } catch (error) {
    console.error("[subscription] Error incrementing usage:", error);
    return false;
  }
}

/**
 * Get demo user ID (for testing without real auth).
 * TODO: Replace with real authenticated user ID from session/token.
 */
export function getDemoUserId(): string {
  return "demo-user-default";
}

/**
 * Helper: Check if subscription is active (unlocked).
 * "free" status means free tier, "active" means paid/trialing.
 */
export function isSubscriptionActive(subscription: UserSubscription): boolean {
  return subscription.status === "active" || subscription.status === "pending_activation";
}
