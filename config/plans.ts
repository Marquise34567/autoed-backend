export type PlanId = 'starter' | 'creator' | 'studio' | 'free'

export const PLAN_IDS: PlanId[] = ['starter', 'creator', 'studio']

// Backwards-compatible named properties (e.g., PLAN_IDS.FREE)
;(PLAN_IDS as any).FREE = 'free'
;(PLAN_IDS as any).STARTER = 'starter'
;(PLAN_IDS as any).CREATOR = 'creator'
;(PLAN_IDS as any).STUDIO = 'studio'

export type PlanDefinition = {
  id: PlanId | 'free'
  name: string
  features: {
    rendersPerMonth: number
    maxVideoLengthMinutes: number
    exportQuality: '720p' | '1080p' | '4k'
    hasWatermark: boolean
    queuePriority: 'standard' | 'priority' | 'ultra'
  }
}

const DEFAULT_PLANS: Record<string, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    features: { rendersPerMonth: 10, maxVideoLengthMinutes: 5, exportQuality: '720p', hasWatermark: true, queuePriority: 'standard' },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    features: { rendersPerMonth: 100, maxVideoLengthMinutes: 10, exportQuality: '720p', hasWatermark: true, queuePriority: 'standard' },
  },
  creator: {
    id: 'creator',
    name: 'Creator',
    features: { rendersPerMonth: 1000, maxVideoLengthMinutes: 30, exportQuality: '1080p', hasWatermark: false, queuePriority: 'priority' },
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    features: { rendersPerMonth: 999999, maxVideoLengthMinutes: 120, exportQuality: '4k', hasWatermark: false, queuePriority: 'ultra' },
  },
}

export function getPlan(idOrPlan: string | PlanId | PlanDefinition): PlanDefinition {
  if (!idOrPlan) return DEFAULT_PLANS.free
  if (typeof idOrPlan === 'string') {
    const key = (idOrPlan || '').toString().trim().toLowerCase()
    if (DEFAULT_PLANS[key]) return DEFAULT_PLANS[key]
    return DEFAULT_PLANS.free
  }
  return idOrPlan
}

export default { PLAN_IDS, getPlan, DEFAULT_PLANS }
