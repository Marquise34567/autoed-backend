// Supabase removed — provide minimal DB functions backed by Firestore or stubs
import admin from '@/lib/firebaseAdmin'

export async function getUserSubscription(userId: string) {
  return null
}

export async function updateUserSubscription(userId: string, updates: any) {
  return { user_id: userId, ...updates }
}

export async function dbIncrementRenderUsage(userId: string, monthKey: string): Promise<boolean> {
  // Stubbed increment: return true to indicate success
  return true
}

// Backwards-compatible alias for callers using `incrementRenderUsage`
export const incrementRenderUsage = dbIncrementRenderUsage

export async function updateSubscriptionByStripeCustomerId(customerId: string, updates: any) {
  return null
}

export async function getMonthlyUsage(userId: string, monthKey: string) {
  return { renders_used: 0 }
}
