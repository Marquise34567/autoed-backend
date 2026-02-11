import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import * as fsSync from "fs";
import { randomUUID } from "crypto";
import { getJob, updateJob, appendJobLog } from "@/lib/server/jobStore";
import { checkBinaries } from "@/lib/ffmpeg/resolve";
import { applyEDL } from "@/lib/edl/apply";
import type { EDL } from "@/lib/edl/types";
import { getPlan } from "@/config/plans";
import { getUserSubscription, getDemoUserId, incrementRenderUsage, getUserEntitlements } from "@/lib/server/subscription";
import { getVideoMetadata } from "@/lib/server/ffprobe";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Simple in-process concurrency limiter (per user)
const activeRenders = new Map<string, number>();
const maxConcurrencyByPlan: Record<string, number> = {
  free: 1,
  starter: 1,
  creator: 2,
  studio: 3,
};

function getMaxConcurrency(planId: string): number {
  return maxConcurrencyByPlan[planId] ?? 1;
}

function incrementActiveRenders(userId: string) {
  const current = activeRenders.get(userId) ?? 0;
  activeRenders.set(userId, current + 1);
}

function decrementActiveRenders(userId: string) {
  const current = activeRenders.get(userId) ?? 0;
  if (current <= 1) {
    activeRenders.delete(userId);
  } else {
    activeRenders.set(userId, current - 1);
  }
}

export async function POST(request: Request) {
  try {
    // AUTH & BILLING CHECK
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    
    // Check billing status
    const { data: billingData } = await supabase
      .from('billing_status')
      .select('plan, status')
      .eq('user_id', user.id)
      .single();
    
    if (!billingData || billingData.status !== 'active' || billingData.plan === 'free') {
      return NextResponse.json(
        { 
          error: "This feature requires an active Creator or Studio subscription",
          upgrade_url: "/pricing"
        },
        { status: 402 }
      );
    }
    
    // PREFLIGHT CHECK: Verify FFmpeg is available
    try {
      const bins = checkBinaries();
      console.log("[preflight] FFmpeg:", bins.ffmpeg);
    } catch (error) {
      console.error("[preflight] Binary check failed:", error);
      return NextResponse.json(
        {
          error: "FFmpeg not found",
          details: error instanceof Error ? error.message : "Install FFmpeg",
        },
        { status: 500 }
      );
    }
    
    const body = await request.json();
    const {
      jobId,
      soundEnhance = true,
      exportQuality,
    } = body as {
      jobId?: string;
      soundEnhance: boolean;
      exportQuality?: "720p" | "1080p" | "4k";
    };

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const job = getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (!job.filePath) {
      return NextResponse.json({ error: "Job missing input file path" }, { status: 400 });
    }

    // Verify input file exists
    if (!fsSync.existsSync(job.filePath)) {
      return NextResponse.json(
        { error: "Input file not found", details: `File missing at ${job.filePath}` },
        { status: 404 }
      );
    }

    const inputStats = fsSync.statSync(job.filePath);
    console.log(`[generate] Input file size: ${(inputStats.size / 1024 / 1024).toFixed(2)} MB`);

    // Check for EDL
    const edl = job.details?.edl as EDL | undefined;
    if (!edl) {
      return NextResponse.json(
        { error: "No EDL found", details: "Analysis must complete first and produce edl.json" },
        { status: 400 }
      );
    }


    console.log(`[generate] EDL found: hook + ${edl.segments.length} segments`);

    // ========== SERVER-SIDE ENTITLEMENT CHECK: Non-bypassable billing enforcement ==========
    const userId = getDemoUserId(); // TODO: Get real userId from auth session
    const entitlements = await getUserEntitlements(userId);
    const subscription = await getUserSubscription(userId);
    const effectivePlanId = entitlements.planId;
    const effectivePlan = getPlan(effectivePlanId);

    console.log(`[generate] User ${userId} entitlements: plan=${effectivePlanId}, renders=${entitlements.rendersPerMonth}`);

    // Check 1: Render quota (based on entitlements, not subscription)
    if (
      entitlements.rendersPerMonth < 999999 &&
      subscription.rendersUsedThisPeriod >= entitlements.rendersPerMonth
    ) {
      const errorMsg = `Render limit exceeded on ${effectivePlan.name} plan`;
      console.warn(`[generate] ${errorMsg} (user: ${userId}, used: ${subscription.rendersUsedThisPeriod}/${entitlements.rendersPerMonth})`);

      updateJob(jobId, {
        status: "FAILED",
        stage: "Failed",
        message: errorMsg,
        error: errorMsg,
      });
      appendJobLog(
        jobId,
        `Rejected: ${errorMsg} (${subscription.rendersUsedThisPeriod}/${entitlements.rendersPerMonth})`
      );

      return NextResponse.json(
        {
          ok: false,
          code: "QUOTA_EXCEEDED",
          message: "Upgrade to render more",
          planRequired: effectivePlanId === "free" ? "starter" : effectivePlanId,
        },
        { status: 402 }
      );
    }

    // Check 2: Max video length (based on entitlements)
    const inputMetadata = await getVideoMetadata(job.filePath);
    const inputDurationMinutes = inputMetadata.duration / 60;
    if (inputDurationMinutes > entitlements.maxVideoLengthMinutes) {
      const errorMsg = `Video too long for ${effectivePlan.name} plan (max ${entitlements.maxVideoLengthMinutes} min)`;
      console.warn(`[generate] ${errorMsg} (video: ${inputDurationMinutes.toFixed(1)} min)`);

      updateJob(jobId, {
        status: "FAILED",
        stage: "Failed",
        message: errorMsg,
        error: errorMsg,
      });
      appendJobLog(jobId, `Rejected: ${errorMsg}`);

      return NextResponse.json(
        {
          ok: false,
          code: "VIDEO_TOO_LONG",
          message: "Video exceeds plan limit",
          planRequired: effectivePlanId === "free" ? "starter" : effectivePlanId,
        },
        { status: 402 }
      );
    }

    // Check 3: Export quality (based on entitlements)
    const requestedQuality = exportQuality || entitlements.exportQuality;
    const qualityOrder = { "720p": 1, "1080p": 2, "4k": 3 };
    const maxQualityLevel = qualityOrder[entitlements.exportQuality];
    const requestedQualityLevel = qualityOrder[requestedQuality];

    if (requestedQualityLevel > maxQualityLevel) {
      const errorMsg = `Export quality ${requestedQuality} not allowed on ${effectivePlan.name} plan (max ${entitlements.exportQuality})`;
      console.warn(`[generate] ${errorMsg}`);

      updateJob(jobId, {
        status: "FAILED",
        stage: "Failed",
        message: errorMsg,
        error: errorMsg,
      });
      appendJobLog(jobId, `Rejected: ${errorMsg}`);

      return NextResponse.json(
        {
          ok: false,
          code: "QUALITY_NOT_ALLOWED",
          message: "Export quality exceeds plan limit",
          planRequired: effectivePlanId === "free" ? "starter" : effectivePlanId,
        },
        { status: 402 }
      );
    }

    const maxDurationSec = entitlements.maxVideoLengthMinutes * 60;
    if (inputMetadata.duration > maxDurationSec) {
      const errorMsg = `Video too long for ${effectivePlan.name} plan`;
      updateJob(jobId, {
        status: "FAILED",
        stage: "Failed",
        message: errorMsg,
        error: errorMsg,
      });
      appendJobLog(jobId, `${errorMsg}: ${inputMetadata.duration.toFixed(2)}s > ${maxDurationSec}s`);

      return NextResponse.json(
        {
          ok: false,
          code: "MAX_DURATION_EXCEEDED",
          message: "Upgrade to upload longer videos",
          planRequired: effectivePlanId === "free" ? "starter" : effectivePlanId,
        },
        { status: 402 }
      );
    }

    // Check 4: Concurrency limit
    const currentActive = activeRenders.get(userId) ?? 0;
    const maxConcurrent = getMaxConcurrency(effectivePlanId);
    if (currentActive >= maxConcurrent) {
      const errorMsg = `Too many concurrent renders for ${effectivePlan.name} plan`;
      updateJob(jobId, {
        status: "FAILED",
        stage: "Failed",
        message: errorMsg,
        error: errorMsg,
      });
      appendJobLog(jobId, errorMsg);

      return NextResponse.json(
        {
          ok: false,
          code: "CONCURRENCY_LIMIT",
          message: "Upgrade for more concurrent renders",
          planRequired: effectivePlanId === "free" ? "starter" : effectivePlanId,
        },
        { status: 429 }
      );
    }

    console.log(
      `[generate] Entitlement check passed: ${effectivePlan.name} plan, ` +
        `${subscription.rendersUsedThisPeriod}/${
          effectivePlan.features.rendersPerMonth >= 999999
            ? "∞"
            : effectivePlan.features.rendersPerMonth
        } renders used`
    );

    updateJob(jobId, {
      status: "RENDERING_FINAL",
      stage: "Rendering",
      message: "Final render: starting",
      priority: effectivePlan.features.queuePriority,
    });
    appendJobLog(jobId, `Starting render on ${effectivePlan.name} plan (priority: ${effectivePlan.features.queuePriority})`);

    const outputDir = path.join(process.cwd(), "public", "outputs", jobId);
    await fs.mkdir(outputDir, { recursive: true });

    const runId = randomUUID();
    const finalFileName = `final_${jobId}_${runId}.mp4`;
    const finalPath = path.join(outputDir, finalFileName);
    
    console.log(`[generate] Input: ${job.filePath}`);
    console.log(`[generate] Output: ${finalPath}`);
    console.log(`[generate] Applying EDL with ${edl.segments.length + 1} parts...`);
    const renderStart = Date.now();
    appendJobLog(jobId, `Render start: ${new Date(renderStart).toISOString()}`);
    appendJobLog(jobId, "Strategy: single-pass filter_complex concat");


    // Apply EDL (with concurrency limiter)
    incrementActiveRenders(userId);
    let result:
      | Awaited<ReturnType<typeof applyEDL>>
      | undefined;
    try {
      result = await applyEDL({
        inputPath: job.filePath,
        edl,
        outputPath: finalPath,
        jobId,
        soundEnhance,
        watermark: effectivePlan.features.hasWatermark,
        exportQuality: exportQuality ?? effectivePlan.features.exportQuality,
        onProgress: (update) => {
          const percent = Math.round(update.progress * 100);
          updateJob(jobId, {
            percent,
            progress: update.progress,
            etaSec: Math.round(update.etaSec),
            stage: "Final render",
            message: `Final render: ${percent}%`,
          });
        },
      });
    } finally {
      decrementActiveRenders(userId);
    }

    const renderEnd = Date.now();
    const elapsedSec = (renderEnd - renderStart) / 1000;
    appendJobLog(jobId, `Render end: ${new Date(renderEnd).toISOString()} (${elapsedSec.toFixed(2)}s)`);

    if (!result.success) {
      const errorMsg = `EDL application failed: ${result.error}`;
      const fullDetails = result.details || result.error;
      console.error(`[generate] ${errorMsg}`);
      if (result.stderr) {
        console.error(`[generate] FFmpeg stderr:\n${result.stderr}`);
      }
      updateJob(jobId, {
        status: "FAILED",
        stage: "Failed",
        message: errorMsg,
        error: errorMsg,
      });
      appendJobLog(jobId, `${errorMsg}\nDetails: ${fullDetails}`);
      return NextResponse.json(
        { 
          error: "Generate failed", 
          details: fullDetails,
          ffmpegError: result.stderr ? result.stderr.substring(0, 2000) : undefined,
        },
        { status: 500 }
      );
    }

    // Verify output file exists and has reasonable size
    if (!fsSync.existsSync(finalPath)) {
      const errorMsg = "EDL output file was not created";
      console.error(`[generate] ${errorMsg}`);
      updateJob(jobId, {
        status: "FAILED",
        stage: "Failed",
        message: errorMsg,
        error: errorMsg,
      });
      appendJobLog(jobId, errorMsg);
      return NextResponse.json(
        { error: "Generate failed", details: errorMsg },
        { status: 500 }
      );
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
      updateJob(jobId, {
        status: "FAILED",
        stage: "Failed",
        message: errorMsg,
        error: errorMsg,
      });
      appendJobLog(jobId, errorMsg);
      return NextResponse.json(
        { error: "Generate failed", details: errorMsg },
        { status: 500 }
      );
    }

    // Check if edits were meaningful
    const usedEdl = result.usedEdl ?? edl;
    const usedEdlPath = path.join(process.cwd(), "tmp", "jobs", jobId, "edl_used.json");
    await fs.mkdir(path.dirname(usedEdlPath), { recursive: true });
    await fs.writeFile(usedEdlPath, JSON.stringify(usedEdl, null, 2));
    console.log(`[generate] EDL used saved: ${usedEdlPath}`);
    console.log(`[generate] EDL used: ${JSON.stringify(usedEdl)}`);
    appendJobLog(jobId, `EDL used: ${JSON.stringify(usedEdl)}`);
    const originalDuration = result.originalDurationSec ?? usedEdl.expectedChange.originalDurationSec;
    const finalDuration = result.finalDurationSec ?? usedEdl.expectedChange.finalDurationSec;
    const removedSeconds = result.removedSec ?? usedEdl.expectedChange.totalRemovedSec;
    const hookFromStart = usedEdl.hook.start <= 3;
    const minRemoved = Math.max(3, originalDuration * 0.05);

    if (removedSeconds < minRemoved || (originalDuration >= 10 && hookFromStart)) {
      const errorMsg = "No meaningful edits applied";
      updateJob(jobId, {
        status: "FAILED",
        stage: "Failed",
        message: errorMsg,
        error: errorMsg,
      });
      appendJobLog(jobId, `${errorMsg} (removed ${removedSeconds.toFixed(1)}s, hookStart=${usedEdl.hook.start.toFixed(1)}s)`);
      return NextResponse.json(
        { error: errorMsg, details: "Rendered output did not differ meaningfully" },
        { status: 500 }
      );
    }

    const outputUrl = `/outputs/${jobId}/${finalFileName}?v=${Date.now()}`;

    // Success: Update job to DONE
    const nextJob = updateJob(jobId, {
      status: "DONE",
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

    appendJobLog(jobId, `✓ Final render complete: ${outputSizeMB.toFixed(2)}MB`);
    appendJobLog(jobId, `✓ Removed ${removedSeconds.toFixed(1)}s, final ${finalDuration.toFixed(1)}s`);

    // ========== INCREMENT RENDER USAGE (atomic, after confirmed success) ==========
    try {
      const usageIncremented = await incrementRenderUsage(userId);
      if (usageIncremented) {
        const updatedSub = await getUserSubscription(userId);
        console.log(
          `[generate] Render usage incremented: ${updatedSub.rendersUsedThisPeriod}/${
            effectivePlan.features.rendersPerMonth >= 999999
              ? "∞"
              : effectivePlan.features.rendersPerMonth
          }`
        );
        appendJobLog(jobId, `Subscription: ${updatedSub.rendersUsedThisPeriod} renders used this period`);
      } else {
        console.warn('[generate] Failed to increment usage in database');
        appendJobLog(jobId, `Warning: Failed to increment usage counter (data may be inconsistent)`);
      }
    } catch (err) {
      console.error(`[generate] Failed to increment render usage:`, err);
      appendJobLog(jobId, `Warning: Failed to increment usage counter (data may be inconsistent)`);
    }

    console.log(`[generate] === GENERATE COMPLETE ===`);
    return NextResponse.json({
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
  } catch (error) {
    console.error("[generate] === ERROR ===");
    console.error("Error:", error instanceof Error ? error.message : String(error));
    
    const body = await request.json().catch(() => ({}));
    const jobId = (body as { jobId?: string }).jobId;

    if (jobId) {
      try {
        updateJob(jobId, {
          status: "FAILED",
          stage: "Failed",
          message: "Generate failed",
          error: error instanceof Error ? error.message : String(error),
        });
        appendJobLog(jobId, `Failed: ${error instanceof Error ? error.message : String(error)}`);
      } catch {
        // ignore update errors
      }
    }

    return NextResponse.json(
      { 
        error: "Generate failed", 
        details: error instanceof Error ? error.message : String(error),
        jobId: jobId || null,
      },
      { status: 500 }
    );
  }
}
