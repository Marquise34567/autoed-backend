"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRIPE_PRICES = void 0;
exports.resolvePriceId = resolvePriceId;
exports.STRIPE_PRICES = {
    starter: {
        monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY || '',
        annual: process.env.STRIPE_PRICE_STARTER_ANNUAL || '',
    },
    creator: {
        monthly: process.env.STRIPE_PRICE_CREATOR_MONTHLY || '',
        annual: process.env.STRIPE_PRICE_CREATOR_ANNUAL || '',
    },
    studio: {
        monthly: process.env.STRIPE_PRICE_STUDIO_MONTHLY || '',
        annual: process.env.STRIPE_PRICE_STUDIO_ANNUAL || '',
    },
};
function resolvePriceId(planInput, intervalInput = 'monthly') {
    const p = String(planInput || '').trim().toLowerCase();
    const planKey = p === 'pro' ? 'creator' : p === 'team' ? 'studio' : p;
    const iRaw = String(intervalInput || '').trim().toLowerCase();
    const interval = (iRaw === 'annual' || iRaw === 'year' || iRaw === 'yearly' || iRaw.startsWith('ann')) ? 'annual' : 'monthly';
    const map = exports.STRIPE_PRICES[planKey];
    if (!map)
        return null;
    const price = map[interval];
    return price && price.length > 0 ? price : null;
}
