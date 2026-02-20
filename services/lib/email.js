"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPurchaseEmail = sendPurchaseEmail;
const node_fetch_1 = __importDefault(require("node-fetch"));
const plans_1 = require("./plans");
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@example.com';
async function sendPurchaseEmail(to, planKey, currentPeriodEnd) {
    const features = (0, plans_1.planFeatures)(planKey);
    const endDate = currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toDateString() : 'N/A';
    const subject = `Thanks for subscribing — Your ${planKey} plan is active`;
    const body = `Hi —\n\nThanks for subscribing to AutoEditor. Your ${planKey} plan is active.\n\nSubscription renews/ends on: ${endDate}\n\nUnlocked features:\n- ${features.join('\n- ')}\n\nVisit your editor: https://your-domain.example.com/editor\n\nThanks,\nAutoEditor Team`;
    if (RESEND_API_KEY) {
        try {
            await (0, node_fetch_1.default)('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
                body: JSON.stringify({
                    from: FROM_EMAIL,
                    to: [to],
                    subject,
                    text: body
                })
            });
            console.log('[email] sent purchase email to', to);
            return true;
        }
        catch (e) {
            console.warn('[email] resend send failed', e);
        }
    }
    // fallback: log and no-op
    console.warn('[email] no provider configured — would send:', { to, subject, body });
    return false;
}
