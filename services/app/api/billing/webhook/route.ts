import { NextResponse } from "next/server";
import { updateUserSubscription, getDemoUserId } from "@/lib/server/subscription";

export const runtime = "nodejs";

/**
 * POST /api/billing/webhook
 *
 * Stripe webhook handler.
 * Verifies signature and updates subscription status.
 *
 * TODO: When Stripe is fully integrated:
 * 1. Set STRIPE_WEBHOOK_SECRET in .env.local
 * 2. Install @stripe/stripe-js and stripe package
 * 3. Use stripe.webhooks.constructEvent to verify signature
 * 4. Handle events: customer.subscription.{created,updated,deleted}, invoice.payment_*
 *
 * For now: This is a scaffold. Returns 501 (Not Implemented) with clear TODO.
 */
export async function POST(request: Request) {
  try {
    const body = await request.text();
    const sig = request.headers.get("stripe-signature");

    console.log("[webhook] Stripe webhook received");
    console.log("[webhook] Signature:", sig);

    // =========== TODO: IMPLEMENT STRIPE VERIFICATION ===========
    // const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    // const event = stripe.webhooks.constructEvent(
    //   body,
    //   sig,
    //   process.env.STRIPE_WEBHOOK_SECRET
    // );
    // ============================================================

    // For now, return "not implemented"
    console.warn(
      "[webhook] Stripe webhook handler not yet implemented. Set up:"
    );
    console.warn("  1. STRIPE_SECRET_KEY in .env.local");
    console.warn("  2. STRIPE_WEBHOOK_SECRET in .env.local");
    console.warn("  3. Uncomment stripe.webhooks.constructEvent() above");

    return NextResponse.json(
      {
        received: true,
        warning:
          "Webhook scaffolding in place. Stripe integration TODO. See logs.",
      },
      { status: 200 } // Stripe expects 2xx
    );

    // =========== EXAMPLE: What real handler would look like ===========
    // switch (event.type) {
    //   case "customer.subscription.created":
    //   case "customer.subscription.updated": {
    //     const subscription = event.data.object;
    //     // Map subscription.status -> our status enum
    //     // Get user from customerId lookup
    //     // Call updateUserSubscription()
    //     break;
    //   }
    //   case "customer.subscription.deleted": {
    //     const subscription = event.data.object;
    //     // Call updateUserSubscription(userId, { status: "canceled" })
    //     break;
    //   }
    //   case "invoice.payment_succeeded": {
    //     // Stripe already updated subscription on creation/update event
    //     break;
    //   }
    //   case "invoice.payment_failed": {
    //     const invoice = event.data.object;
    //     // Call updateUserSubscription(userId, { status: "past_due" })
    //     break;
    //   }
    // }
    // ===================================================================
  } catch (error) {
    console.error("[webhook] Error processing webhook:", error);
    return NextResponse.json(
      {
        received: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
