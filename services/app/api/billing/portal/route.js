"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.POST = POST;
const firebase_admin_1 = __importDefault(require("@/lib/firebase-admin"));
const server_1 = require("@/lib/stripe/server");
exports.runtime = 'nodejs';
async function POST(req) {
    try {
        const { uid } = await req.json();
        if (!uid)
            return new Response('Missing uid', { status: 400 });
        const userDoc = await firebase_admin_1.default.firestore().collection('users').doc(uid).get();
        const user = userDoc.data();
        if (!user || !user.stripeCustomerId)
            return new Response('No customer', { status: 400 });
        const origin = process.env.APP_ORIGIN || process.env.APP_URL || '';
        if (!server_1.stripe)
            return new Response(JSON.stringify({ ok: false, error: 'Billing not configured' }), { status: 503 });
        const session = await server_1.stripe.billingPortal.sessions.create({ customer: user.stripeCustomerId, return_url: `${origin}/editor` });
        return new Response(JSON.stringify({ url: session.url }), { status: 200 });
    }
    catch (e) {
        console.error('[billing] portal error', e);
        return new Response('portal error', { status: 500 });
    }
}
