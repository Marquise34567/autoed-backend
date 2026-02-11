export type Interval = 'monthly' | 'annual'

export const STRIPE_PRICES: Record<string, Partial<Record<Interval, string>>> = {
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
}

export function resolvePriceId(planInput: string, intervalInput: string = 'monthly'): string | null {
  const p = String(planInput || '').trim().toLowerCase()
  const planKey = p === 'pro' ? 'creator' : p === 'team' ? 'studio' : p

  const iRaw = String(intervalInput || '').trim().toLowerCase()
  const interval: Interval = (iRaw === 'annual' || iRaw === 'year' || iRaw === 'yearly' || iRaw.startsWith('ann')) ? 'annual' : 'monthly'

  const map = STRIPE_PRICES[planKey]
  if (!map) return null
  const price = map[interval]
  return price && price.length > 0 ? price : null
}
// Compatibility re-export: single source of truth is src/lib/stripePrices.ts
export { STRIPE_PRICES, resolvePriceId } from './stripePrices'

