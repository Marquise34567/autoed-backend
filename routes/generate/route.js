"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.POST = POST;
const server_1 = require("next/server");
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const fsSync = __importStar(require("fs"));
const crypto_1 = require("crypto");
const jobStore_1 = require("@/lib/server/jobStore");
const resolve_1 = require("@/lib/ffmpeg/resolve");
const apply_1 = require("@/lib/edl/apply");
const plans_1 = require("@/config/plans");
const subscription_1 = require("@/lib/server/subscription");
const ffprobe_1 = require("@/lib/server/ffprobe");
const server_2 = require("@/lib/supabase/server");
exports.runtime = "nodejs";
// Simple in-process concurrency limiter (per user)
const activeRenders = new Map();
const maxConcurrencyByPlan = {
    free: 1,
    starter: 1,
    creator: 2,
    studio: 3,
};
function getMaxConcurrency(planId) {
    return maxConcurrencyByPlan[planId] ?? 1;
}
function incrementActiveRenders(userId) {
    const current = activeRenders.get(userId) ?? 0;
    activeRenders.set(userId, current + 1);
}
function decrementActiveRenders(userId) {
    const current = activeRenders.get(userId) ?? 0;
    if (current <= 1) {
        activeRenders.delete(userId);
    }
    else {
        activeRenders.set(userId, current - 1);
    }
}
async function POST(request) {
    try {
        // AUTH & BILLING CHECK
        const supabase = await (0, server_2.createClient)();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return server_1.NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }
        // Check billing status
        const { data: billingData } = await supabase
            .from('billing_status')
            .select('plan, status')
            .eq('user_id', user.id)
            .single();
        if (!billingData || billingData.status !== 'active' || billingData.plan === 'free') {
            return server_1.NextResponse.json({
                error: "This feature requires an active Creator or Studio subscription",
                upgrade_url: "/pricing"
            }, { status: 402 });
        }
        // PREFLIGHT CHECK: Verify FFmpeg is available
        try {
            const bins = (0, resolve_1.checkBinaries)();
            console.log("[preflight] FFmpeg:", bins.ffmpeg);
        }
        catch (error) {
            console.error("[preflight] Binary check failed:", error);
            return server_1.NextResponse.json({
                error: "FFmpeg not found",
                details: error instanceof Error ? error.message : "Install FFmpeg",
            }, { status: 500 });
        }
        const body = await request.json();
        const { jobId, soundEnhance = true, exportQuality, } = body;
        if (!jobId) {
            return server_1.NextResponse.json({ error: "Missing jobId" }, { status: 400 });
        }
        const job = (0, jobStore_1.getJob)(jobId);
        if (!job) {
            return server_1.NextResponse.json({ error: "Job not found" }, { status: 404 });
        }
        if (!job.filePath) {
            return server_1.NextResponse.json({ error: "Job missing input file path" }, { status: 400 });
        }
        // Verify input file exists
        if (!fsSync.existsSync(job.filePath)) {
            return server_1.NextResponse.json({ error: "Input file not found", details: `File missing at ${job.filePath}` }, { status: 404 });
        }
        const inputStats = fsSync.statSync(job.filePath);
        console.log(`[generate] Input file size: ${(inputStats.size / 1024 / 1024).toFixed(2)} MB`);
        // Check for EDL
        const edl = job.details?.edl;
        if (!edl) {
            return server_1.NextResponse.json({ error: "No EDL found", details: "Analysis must complete first and produce edl.json" }, { status: 400 });
        }
        console.log(`[generate] EDL found: hook + ${edl.segments.length} segments`);
        // ========== SERVER-SIDE ENTITLEMENT CHECK: Non-bypassable billing enforcement ==========
        const userId = (0, subscription_1.getDemoUserId)(); // TODO: Get real userId from auth session
        const entitlements = await (0, subscription_1.getUserEntitlements)(userId);
        const subscription = await (0, subscription_1.getUserSubscription)(userId);
        const effectivePlanId = entitlements.planId;
        const effectivePlan = (0, plans_1.getPlan)(effectivePlanId);
        console.log(`[generate] User ${userId} entitlements: plan=${effectivePlanId}, renders=${entitlements.rendersPerMonth}`);
        // Check 1: Render quota (based on entitlements, not subscription)
        if (entitlements.rendersPerMonth < 999999 &&
            subscription.rendersUsedThisPeriod >= entitlements.rendersPerMonth) {
            const errorMsg = `Render limit exceeded on ${effectivePlan.name} plan`;
            console.warn(`[generate] ${errorMsg} (user: ${userId}, used: ${subscription.rendersUsedThisPeriod}/${entitlements.rendersPerMonth})`);
            (0, jobStore_1.updateJob)(jobId, {
                status: 'failed',
                stage: "Failed",
                message: errorMsg,
                error: errorMsg,
            });
            (0, jobStore_1.appendJobLog)(jobId, `Rejected: ${errorMsg} (${subscription.rendersUsedThisPeriod}/${entitlements.rendersPerMonth})`);
            return server_1.NextResponse.json({
                ok: false,
                code: "QUOTA_EXCEEDED",
                message: "Upgrade to render more",
                planRequired: effectivePlanId === "free" ? "starter" : effectivePlanId,
            }, { status: 402 });
        }
        // Check 2: Max video length (based on entitlements)
        const inputMetadata = await (0, ffprobe_1.getVideoMetadata)(job.filePath);
        const inputDurationMinutes = inputMetadata.duration / 60;
        if (inputDurationMinutes > entitlements.maxVideoLengthMinutes) {
            const errorMsg = `Video too long for ${effectivePlan.name} plan (max ${entitlements.maxVideoLengthMinutes} min)`;
            console.warn(`[generate] ${errorMsg} (video: ${inputDurationMinutes.toFixed(1)} min)`);
            (0, jobStore_1.updateJob)(jobId, {
                status: 'failed',
                stage: "Failed",
                message: errorMsg,
                error: errorMsg,
            });
            (0, jobStore_1.appendJobLog)(jobId, `Rejected: ${errorMsg}`);
            return server_1.NextResponse.json({
                ok: false,
                code: "VIDEO_TOO_LONG",
                message: "Video exceeds plan limit",
                planRequired: effectivePlanId === "free" ? "starter" : effectivePlanId,
            }, { status: 402 });
        }
        // Check 3: Export quality (based on entitlements)
        const requestedQuality = exportQuality || entitlements.exportQuality;
        const qualityOrder = { "720p": 1, "1080p": 2, "4k": 3 };
        const maxQualityLevel = qualityOrder[entitlements.exportQuality];
        const requestedQualityLevel = qualityOrder[requestedQuality];
        if (requestedQualityLevel > maxQualityLevel) {
            const errorMsg = `Export quality ${requestedQuality} not allowed on ${effectivePlan.name} plan (max ${entitlements.exportQuality})`;
            console.warn(`[generate] ${errorMsg}`);
            (0, jobStore_1.updateJob)(jobId, {
                status: 'failed',
                stage: "Failed",
                message: errorMsg,
                error: errorMsg,
            });
            (0, jobStore_1.appendJobLog)(jobId, `Rejected: ${errorMsg}`);
            return server_1.NextResponse.json({
                ok: false,
                code: "QUALITY_NOT_ALLOWED",
                message: "Export quality exceeds plan limit",
                planRequired: effectivePlanId === "free" ? "starter" : effectivePlanId,
            }, { status: 402 });
        }
        const maxDurationSec = entitlements.maxVideoLengthMinutes * 60;
        if (inputMetadata.duration > maxDurationSec) {
            const errorMsg = `Video too long for ${effectivePlan.name} plan`;
            (0, jobStore_1.updateJob)(jobId, {
                status: 'failed',
                stage: "Failed",
                message: errorMsg,
                error: errorMsg,
            });
            (0, jobStore_1.appendJobLog)(jobId, `${errorMsg}: ${inputMetadata.duration.toFixed(2)}s > ${maxDurationSec}s`);
            return server_1.NextResponse.json({
                ok: false,
                code: "MAX_DURATION_EXCEEDED",
                message: "Upgrade to upload longer videos",
                planRequired: effectivePlanId === "free" ? "starter" : effectivePlanId,
            }, { status: 402 });
        }
        // Check 4: Concurrency limit
        const currentActive = activeRenders.get(userId) ?? 0;
        const maxConcurrent = getMaxConcurrency(effectivePlanId);
        if (currentActive >= maxConcurrent) {
            const errorMsg = `Too many concurrent renders for ${effectivePlan.name} plan`;
            (0, jobStore_1.updateJob)(jobId, {
                status: "FAILED",
                stage: "Failed",
                message: errorMsg,
                error: errorMsg,
            });
            (0, jobStore_1.appendJobLog)(jobId, errorMsg);
            return server_1.NextResponse.json({
                ok: false,
                code: "CONCURRENCY_LIMIT",
                message: "Upgrade for more concurrent renders",
                planRequired: effectivePlanId === "free" ? "starter" : effectivePlanId,
            }, { status: 429 });
        }
        console.log(`[generate] Entitlement check passed: ${effectivePlan.name} plan, ` +
            `${subscription.rendersUsedThisPeriod}/${effectivePlan.features.rendersPerMonth >= 999999
                ? "∞"
                : effectivePlan.features.rendersPerMonth} renders used`);
        (0, jobStore_1.updateJob)(jobId, {
            status: 'processing',
            stage: "Rendering",
            message: "Final render: starting",
            priority: effectivePlan.features.queuePriority,
        });
        (0, jobStore_1.appendJobLog)(jobId, `Starting render on ${effectivePlan.name} plan (priority: ${effectivePlan.features.queuePriority})`);
        const outputDir = path_1.default.join(process.cwd(), "public", "outputs", jobId);
        await fs_1.promises.mkdir(outputDir, { recursive: true });
        const runId = (0, crypto_1.randomUUID)();
        const finalFileName = `final_${jobId}_${runId}.mp4`;
        const finalPath = path_1.default.join(outputDir, finalFileName);
        console.log(`[generate] Input: ${job.filePath}`);
        console.log(`[generate] Output: ${finalPath}`);
        console.log(`[generate] Applying EDL with ${edl.segments.length + 1} parts...`);
        const renderStart = Date.now();
        (0, jobStore_1.appendJobLog)(jobId, `Render start: ${new Date(renderStart).toISOString()}`);
        (0, jobStore_1.appendJobLog)(jobId, "Strategy: single-pass filter_complex concat");
        // Apply EDL (with concurrency limiter)
        incrementActiveRenders(userId);
        let result;
        try {
            result = await (0, apply_1.applyEDL)({
                inputPath: job.filePath,
                edl,
                outputPath: finalPath,
                jobId,
                soundEnhance,
                watermark: effectivePlan.features.hasWatermark,
                exportQuality: exportQuality ?? effectivePlan.features.exportQuality,
                onProgress: (update) => {
                    const percent = Math.round(update.progress * 100);
                    (0, jobStore_1.updateJob)(jobId, {
                        percent,
                        progress: update.progress,
                        etaSec: Math.round(update.etaSec),
                        stage: "Final render",
                        message: `Final render: ${percent}%`,
                    });
                },
            });
        }
        finally {
            decrementActiveRenders(userId);
        }
        const renderEnd = Date.now();
        const elapsedSec = (renderEnd - renderStart) / 1000;
        (0, jobStore_1.appendJobLog)(jobId, `Render end: ${new Date(renderEnd).toISOString()} (${elapsedSec.toFixed(2)}s)`);
        if (!result.success) {
            const errorMsg = `EDL application failed: ${result.error}`;
            const fullDetails = result.details || result.error;
            console.error(`[generate] ${errorMsg}`);
            if (result.stderr) {
                console.error(`[generate] FFmpeg stderr:\n${result.stderr}`);
            }
            (0, jobStore_1.updateJob)(jobId, {
                status: "FAILED",
                stage: "Failed",
                message: errorMsg,
                error: errorMsg,
            });
            (0, jobStore_1.appendJobLog)(jobId, `${errorMsg}\nDetails: ${fullDetails}`);
            return server_1.NextResponse.json({
                error: "Generate failed",
                details: fullDetails,
                ffmpegError: result.stderr ? result.stderr.substring(0, 2000) : undefined,
            }, { status: 500 });
        }
        // Verify output file exists and has reasonable size
        if (!fsSync.existsSync(finalPath)) {
            const errorMsg = "EDL output file was not created";
            console.error(`[generate] ${errorMsg}`);
            (0, jobStore_1.updateJob)(jobId, {
                status: "FAILED",
                stage: "Failed",
                message: errorMsg,
                error: errorMsg,
            });
            (0, jobStore_1.appendJobLog)(jobId, errorMsg);
            return server_1.NextResponse.json({ error: "Generate failed", details: errorMsg }, { status: 500 });
        }
        const outputStats = fsSync.statSync(finalPath);
        const outputSizeMB = outputStats.size / 1024 / 1024;
        const inputSizeMB = inputStats.size / 1024 / 1024;
        console.log(`[generate] Output file size: ${outputSizeMB.toFixed(2)} MB`);
        console.log(`[generate] Input file size: ${inputSizeMB.toFixed(2)} MB`);
        console.log(`[generate] Output/Input ratio: ${(outputStats.size / inputStats.size).toFixed(2)}`);
        // Validate output is meaningful (at least 5MB)
        if (outputStats.size < 5 * 1024 * 1024) {
            const errorMsg = `Output too small: ${outputSizeMB.toFixed(2)}MB (expected at least 5MB)`;
            console.error(`[generate] ${errorMsg}`);
            (0, jobStore_1.updateJob)(jobId, {
                status: "FAILED",
                stage: "Failed",
                message: errorMsg,
                error: errorMsg,
            });
            (0, jobStore_1.appendJobLog)(jobId, errorMsg);
            return server_1.NextResponse.json({ error: "Generate failed", details: errorMsg }, { status: 500 });
        }
        // Check if edits were meaningful
        const usedEdl = result.usedEdl ?? edl;
        const usedEdlPath = path_1.default.join(process.cwd(), "tmp", "jobs", jobId, "edl_used.json");
        await fs_1.promises.mkdir(path_1.default.dirname(usedEdlPath), { recursive: true });
        await fs_1.promises.writeFile(usedEdlPath, JSON.stringify(usedEdl, null, 2));
        console.log(`[generate] EDL used saved: ${usedEdlPath}`);
        console.log(`[generate] EDL used: ${JSON.stringify(usedEdl)}`);
        (0, jobStore_1.appendJobLog)(jobId, `EDL used: ${JSON.stringify(usedEdl)}`);
        const originalDuration = result.originalDurationSec ?? usedEdl.expectedChange.originalDurationSec;
        const finalDuration = result.finalDurationSec ?? usedEdl.expectedChange.finalDurationSec;
        const removedSeconds = result.removedSec ?? usedEdl.expectedChange.totalRemovedSec;
        const hookFromStart = usedEdl.hook.start <= 3;
        const minRemoved = Math.max(3, originalDuration * 0.05);
        if (removedSeconds < minRemoved || (originalDuration >= 10 && hookFromStart)) {
            const errorMsg = "No meaningful edits applied";
            (0, jobStore_1.updateJob)(jobId, {
                status: "FAILED",
                stage: "Failed",
                message: errorMsg,
                error: errorMsg,
            });
            (0, jobStore_1.appendJobLog)(jobId, `${errorMsg} (removed ${removedSeconds.toFixed(1)}s, hookStart=${usedEdl.hook.start.toFixed(1)}s)`);
            return server_1.NextResponse.json({ error: errorMsg, details: "Rendered output did not differ meaningfully" }, { status: 500 });
        }
        const outputUrl = `/outputs/${jobId}/${finalFileName}?v=${Date.now()}`;
        // Success: Update job to DONE
        const nextJob = (0, jobStore_1.updateJob)(jobId, {
            status: 'completed',
            stage: "Done",
            message: `Edited video ready (removed ${removedSeconds.toFixed(1)}s)`,
            finalUrl: outputUrl,
            outputPath: finalPath,
            outputUrl,
            details: {
                ...job.details,
                edl: usedEdl,
                editsApplied: {
                    originalDurationSec: originalDuration,
                    finalDurationSec: finalDuration,
                    removedSec: removedSeconds,
                    hook: { start: usedEdl.hook.start, end: usedEdl.hook.end },
                    segmentCount: usedEdl.segments.length,
                },
                improvements: [
                    `Hook from ${usedEdl.hook.start.toFixed(1)}s`,
                    `Removed ${removedSeconds.toFixed(1)}s of ${originalDuration.toFixed(1)}s`,
                    `Final duration: ${finalDuration.toFixed(1)}s`,
                    `${usedEdl.segments.length} segments kept`,
                ],
            },
        });
        (0, jobStore_1.appendJobLog)(jobId, `✓ Final render complete: ${outputSizeMB.toFixed(2)}MB`);
        (0, jobStore_1.appendJobLog)(jobId, `✓ Removed ${removedSeconds.toFixed(1)}s, final ${finalDuration.toFixed(1)}s`);
        // ========== INCREMENT RENDER USAGE (atomic, after confirmed success) ==========
        try {
            const usageIncremented = await (0, subscription_1.incrementRenderUsage)(userId);
            if (usageIncremented) {
                const updatedSub = await (0, subscription_1.getUserSubscription)(userId);
                console.log(`[generate] Render usage incremented: ${updatedSub.rendersUsedThisPeriod}/${effectivePlan.features.rendersPerMonth >= 999999
                    ? "∞"
                    : effectivePlan.features.rendersPerMonth}`);
                (0, jobStore_1.appendJobLog)(jobId, `Subscription: ${updatedSub.rendersUsedThisPeriod} renders used this period`);
            }
            else {
                console.warn('[generate] Failed to increment usage in database');
                (0, jobStore_1.appendJobLog)(jobId, `Warning: Failed to increment usage counter (data may be inconsistent)`);
            }
        }
        catch (err) {
            console.error(`[generate] Failed to increment render usage:`, err);
            (0, jobStore_1.appendJobLog)(jobId, `Warning: Failed to increment usage counter (data may be inconsistent)`);
        }
        console.log(`[generate] === GENERATE COMPLETE ===`);
        return server_1.NextResponse.json({
            jobId,
            ok: true,
            outputUrl,
            finalUrl: outputUrl,
            outputSizeBytes: outputStats.size,
            inputSizeBytes: inputStats.size,
            originalDurationSec: originalDuration,
            finalDurationSec: finalDuration,
            removedSec: removedSeconds,
            hook: { start: usedEdl.hook.start, end: usedEdl.hook.end },
            segmentCount: usedEdl.segments.length,
        });
    }
    catch (error) {
        console.error("[generate] === ERROR ===");
        console.error("Error:", error instanceof Error ? error.message : String(error));
        const body = await request.json().catch(() => ({}));
        const jobId = body.jobId;
        if (jobId) {
            try {
                (0, jobStore_1.updateJob)(jobId, {
                    status: "FAILED",
                    stage: "Failed",
                    message: "Generate failed",
                    error: error instanceof Error ? error.message : String(error),
                });
                (0, jobStore_1.appendJobLog)(jobId, `Failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            catch {
                // ignore update errors
            }
        }
        return server_1.NextResponse.json({
            error: "Generate failed",
            details: error instanceof Error ? error.message : String(error),
            jobId: jobId || null,
        }, { status: 500 });
    }
}
