/**
 * User Plan & Usage Tracking
 *
 * Current implementation: localStorage-based demo user tracker.
 * TODO: Replace with real auth + DB when available.
 * Structure allows easy swap to Stripe + real user tracking.
 */

import { PLAN_IDS, type PlanId, getPlan } from '@/config/plans';

export interface UserPlanUsage {
  userId: string; // For now: always 'demo-user', TODO: real auth
  planId: PlanId;
  rendersUsedThisMonth: number;
  monthStartDate: string; // ISO date when month counter started
  upgradedAt?: string; // ISO date when plan changed
  stripeCustomerId?: string; // TODO: Add when Stripe integrated
  stripeSubscriptionId?: string; // TODO: Add when Stripe integrated
}

const STORAGE_KEY = 'ae_user_plan_usage';
const DEMO_USER_ID = 'demo-user';

/**
 * Initialize or retrieve current user plan usage.
 * In production with real auth, replace localStorage with DB query.
 */
export function getUserPlanUsage(): UserPlanUsage {
  if (typeof window === 'undefined') {
    // Server-side: return a demo default
    return getDefaultPlanUsage();
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      const initial = getDefaultPlanUsage();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }

    const parsed = JSON.parse(stored) as UserPlanUsage;

    // Reset counter if month has changed
    const monthStart = new Date(parsed.monthStartDate);
    const now = new Date();
    if (monthStart.getMonth() !== now.getMonth() || monthStart.getFullYear() !== now.getFullYear()) {
      parsed.rendersUsedThisMonth = 0;
      parsed.monthStartDate = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }

    return parsed;
  } catch {
    // Corrupted storage, reset
    const initial = getDefaultPlanUsage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }
}

/**
 * Set user plan (simulating an "upgrade" action).
 * In production: call Stripe API or backend to change subscription.
 */
export function setUserPlan(planId: PlanId): UserPlanUsage {
  const usage = getUserPlanUsage();
  usage.planId = planId;
  usage.upgradedAt = new Date().toISOString();
  usage.rendersUsedThisMonth = 0; // Reset usage on upgrade
  usage.monthStartDate = new Date().toISOString();

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
  }

  return usage;
}

/**
 * Increment render counter after successful render.
 * Called by API after final video is exported.
 */
export function incrementRenderUsage(): UserPlanUsage {
  const usage = getUserPlanUsage();
  usage.rendersUsedThisMonth += 1;

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
  }

  return usage;
}

/**
 * Check if user has renders available.
 * Returns: { allowed: boolean, remaining: number }
 */
export function checkRenderAllowance(): { allowed: boolean; remaining: number } {
  const usage = getUserPlanUsage();
  const plan = getPlan(usage.planId);
  const remaining = Math.max(0, plan.features.rendersPerMonth - usage.rendersUsedThisMonth);

  return {
    allowed: remaining > 0,
    remaining,
  };
}

/**
 * Get human-readable usage string.
 * E.g., "4 renders left this month" or "Unlimited renders"
 */
export function getRenderUsageString(): string {
  const usage = getUserPlanUsage();
  const plan = getPlan(usage.planId);

  if (plan.features.rendersPerMonth >= 999999) {
    return 'Unlimited renders';
  }

  const remaining = Math.max(0, plan.features.rendersPerMonth - usage.rendersUsedThisMonth);
  return `${remaining} render${remaining === 1 ? '' : 's'} left this month`;
}

// ============ Server-side helpers (for API routes) ============

/**
 * Server-side version: Get usage from request headers or query.
 * TODO: Replace with real auth context when available.
 *
 * For now, we assume a simple ?userId=demo-user query param
 * or a stubbed session.
 */
export function getUserIdFromRequest(req?: any): string {
  // TODO: When real auth exists:
  // const session = await getSession(req);
  // return session?.user?.id || DEMO_USER_ID;

  return DEMO_USER_ID; // Stub
}

/**
 * Server-side: Get or initialize user plan in "database" (localStorage stub).
 * In production: query real DB.
 */
export function getServerUserPlanUsage(userId: string = DEMO_USER_ID): UserPlanUsage {
  // Stub: use same localStorage. In production, query DB by userId.
  const usage = getUserPlanUsage();
  usage.userId = userId;
  return usage;
}

/**
 * Server-side: Increment usage after successful render completion.
 * In production: atomic DB update.
 */
export function serverIncrementRenderUsage(userId: string = DEMO_USER_ID): UserPlanUsage {
  // Stub: use same increment. In production: atomic DB increment with transaction.
  return incrementRenderUsage();
}

// ============ Private helpers ============

function getDefaultPlanUsage(): UserPlanUsage {
  return {
    userId: DEMO_USER_ID,
    planId: PLAN_IDS.FREE,
    rendersUsedThisMonth: 0,
    monthStartDate: new Date().toISOString(),
  };
}
