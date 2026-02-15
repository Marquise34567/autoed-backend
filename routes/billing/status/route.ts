import { NextResponse } from "next/server";
import { getUserSubscription, getDemoUserId, getUserEntitlements } from "@/lib/server/subscription";
import { getPlan } from "@/config/plans";

export const runtime = "nodejs";

/**
 * GET /api/billing/status
 *
 * Returns the server-truth subscription status + plan entitlements.
 * Frontend calls this on load to know what features are available.
 *
 * Response:
 * {
 *   ok: true,
 *   userId: string,
 *   planId: "free" | "starter" | "creator" | "studio",
 *   subscriptionStatus: "active" | "past_due" | "canceled" | ...,
 *   rendersRemaining: number,
 *   maxVideoMinutes: number,
 *   maxExportQuality: "720p" | "1080p" | "4k",
 *   watermarkRequired: boolean,
 *   queuePriority: "standard" | "priority" | "ultra",
 *   periodEndUnix: number,
 *   periodEndDate: string (ISO),
 *   periodDaysRemaining: number,
 *   canRender: boolean,
 *   message: string (e.g., "Free plan: 7 renders left")
 * }
 */
export async function GET(request: Request) {
  try {
    // TODO: Get real userId from auth session
    const userId = getDemoUserId();

    // Get entitlements (enforces billing safety)
    const entitlements = await getUserEntitlements(userId);
    const subscription = await getUserSubscription(userId);
    const plan = getPlan(entitlements.planId); // Use entitlements.planId, not subscription.planId

    // Determine if user can render (based on entitlements)
    const canRender =
      entitlements.rendersPerMonth >= 999999 ||
      subscription.rendersUsedThisPeriod < entitlements.rendersPerMonth;

    // Calculate period info
    const now = Math.floor(Date.now() / 1000);
    const periodDaysRemaining = Math.max(
      0,
      Math.ceil((subscription.currentPeriodEnd - now) / (24 * 60 * 60))
    );
    const rendersRemaining = Math.max(
      0,
      entitlements.rendersPerMonth >= 999999
        ? 999999
        : entitlements.rendersPerMonth - subscription.rendersUsedThisPeriod
    );

    // Human-readable message
    let message = "";
    let isPending = false;
    
    // Check for pending verification (payment made but webhooks not activating)
    if (subscription.status === 'pending_activation' && subscription.providerSubscriptionId) {
      isPending = true;
      message = "Payment received — activation pending (webhook verification required)";
    } else if (entitlements.rendersPerMonth >= 999999) {
      message = `${plan.name} plan: Unlimited renders`;
    } else {
      message = `${plan.name} plan: ${rendersRemaining}/${entitlements.rendersPerMonth} renders left this period`;
    }

    return NextResponse.json({
      ok: true,
      userId,
      isPending, // Indicates pending verification state
      planId: entitlements.planId,
      subscriptionStatus: subscription.status,
      rendersUsedThisPeriod: subscription.rendersUsedThisPeriod,
      rendersRemaining,
      maxVideoMinutes: entitlements.maxVideoLengthMinutes,
      maxExportQuality: entitlements.exportQuality,
      watermarkRequired: entitlements.hasWatermark,
      queuePriority: entitlements.queuePriority,
      periodStartUnix: subscription.currentPeriodStart,
      periodEndUnix: subscription.currentPeriodEnd,
      periodEndDate: new Date(
        subscription.currentPeriodEnd * 1000
      ).toISOString(),
      periodDaysRemaining,
      canRender,
      message,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[billing-status] Error:", errorMsg, error);
    
    // Always return valid JSON, even on error (non-blocking)
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to get billing status",
        message: "Please refresh the page",
        debug: process.env.NODE_ENV === "development" ? errorMsg : undefined,
      },
      { status: 500 }
    );
  }
}
