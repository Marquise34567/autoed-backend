"use strict";
/**
 * Test utilities for soft billing system
 * Server-side helpers for debugging and testing billing status
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryBillingStatus = queryBillingStatus;
exports.getUserIdByEmail = getUserIdByEmail;
exports.hasActiveSubscription = hasActiveSubscription;
exports.formatBillingStatus = formatBillingStatus;
exports.logBillingStatusChange = logBillingStatusChange;
exports.simulatePaymentConfirmation = simulatePaymentConfirmation;
exports.manuallyActivateSubscription = manuallyActivateSubscription;
exports.resetUserToFree = resetUserToFree;
exports.generateTestReport = generateTestReport;
const supabase_js_1 = require("@supabase/supabase-js");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
}
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseAnonKey);
/**
 * Query billing status for a user
 */
async function queryBillingStatus(userId) {
    try {
        const { data, error } = await supabase
            .from('billing_status')
            .select('*')
            .eq('user_id', userId)
            .single();
        if (error) {
            console.error('Billing status query error:', error.message);
            return null;
        }
        return data;
    }
    catch (err) {
        console.error('Billing status query failed:', err);
        return null;
    }
}
/**
 * Get user ID by email
 */
async function getUserIdByEmail(email) {
    try {
        const { data, error } = await supabase.auth.admin.listUsers();
        if (error) {
            console.error('User list error:', error.message);
            return null;
        }
        const user = data.users.find(u => u.email === email);
        return user?.id || null;
    }
    catch (err) {
        console.error('User lookup failed:', err);
        return null;
    }
}
/**
 * Check if user has active subscription
 */
async function hasActiveSubscription(userId) {
    const billing = await queryBillingStatus(userId);
    return billing?.status === 'active' && billing?.plan !== 'free';
}
/**
 * Format billing status for logging
 */
function formatBillingStatus(billing) {
    if (!billing) {
        return 'NOT_FOUND';
    }
    return `${billing.plan}/${billing.status}`;
}
/**
 * Log billing status change
 */
async function logBillingStatusChange(userId, action, details) {
    const billing = await queryBillingStatus(userId);
    const status = formatBillingStatus(billing);
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] BILLING: ${action} → ${status}`, details || '');
}
/**
 * Simulate payment confirmation (test only)
 * Updates billing status from free/locked to starter/pending
 */
async function simulatePaymentConfirmation(userId, plan = 'starter') {
    try {
        const { data, error } = await supabase
            .from('billing_status')
            .upsert({
            user_id: userId,
            plan,
            status: 'pending', // In soft mode, payments go to pending, not auto-active
            stripe_subscription_id: `sub_test_${Date.now()}`,
            updated_at: new Date().toISOString(),
        })
            .select()
            .single();
        if (error) {
            console.error('Payment simulation error:', error.message);
            return null;
        }
        await logBillingStatusChange(userId, 'PAYMENT_SIMULATED', { plan });
        return data;
    }
    catch (err) {
        console.error('Payment simulation failed:', err);
        return null;
    }
}
/**
 * Manually activate subscription (test only)
 * Only works in soft billing mode
 */
async function manuallyActivateSubscription(userId, plan = 'starter') {
    try {
        const { data, error } = await supabase
            .from('billing_status')
            .upsert({
            user_id: userId,
            plan,
            status: 'active', // Test mode: manually set to active
            stripe_subscription_id: `sub_manual_${Date.now()}`,
            updated_at: new Date().toISOString(),
        })
            .select()
            .single();
        if (error) {
            console.error('Manual activation error:', error.message);
            return null;
        }
        await logBillingStatusChange(userId, 'MANUALLY_ACTIVATED', { plan });
        return data;
    }
    catch (err) {
        console.error('Manual activation failed:', err);
        return null;
    }
}
/**
 * Reset user to free tier (test cleanup)
 */
async function resetUserToFree(userId) {
    try {
        const { data, error } = await supabase
            .from('billing_status')
            .upsert({
            user_id: userId,
            plan: 'free',
            status: 'locked',
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
        })
            .select()
            .single();
        if (error) {
            console.error('Reset error:', error.message);
            return null;
        }
        await logBillingStatusChange(userId, 'RESET_TO_FREE');
        return data;
    }
    catch (err) {
        console.error('Reset failed:', err);
        return null;
    }
}
/**
 * Comprehensive test report
 */
async function generateTestReport(userId) {
    const billing = await queryBillingStatus(userId);
    const hasActive = await hasActiveSubscription(userId);
    return `
═══════════════════════════════════════════════════════════
BILLING STATUS REPORT
═══════════════════════════════════════════════════════════
User ID:              ${userId}
Current Status:       ${formatBillingStatus(billing)}
Has Active Sub:       ${hasActive ? '✓ YES' : '✗ NO'}
Plan:                 ${billing?.plan || 'N/A'}
Status:               ${billing?.status || 'N/A'}
Stripe Sub ID:        ${billing?.stripe_subscription_id || 'NONE'}
Updated:              ${billing?.updated_at || 'N/A'}
═══════════════════════════════════════════════════════════
  `;
}
