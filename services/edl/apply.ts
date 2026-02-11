import * as fsSync from "fs";
import { resolveFfmpegPath } from "@/lib/ffmpeg/resolve";
import { runCommandWithProgress, type ProgressUpdate } from "@/lib/server/exec";
import { getVideoMetadata } from "@/lib/server/ffprobe";
import type { EDL } from "./types";

export interface ApplyEDLResult {
  success: boolean;
  error?: string;
  details?: string;
  stderr?: string;
  usedEdl?: EDL;
  originalDurationSec?: number;
  finalDurationSec?: number;
  removedSec?: number;
  validationDetails?: {
    keptSec?: number;
    segmentCount?: number;
    hookStart?: number;
    hookEnd?: number;
    outputSizeBytes?: number;
    outputDurationSec?: number;
    inputSizeBytes?: number;
    fallbackUsed?: boolean;
  };
}

function sanitizeEDL(edl: EDL, duration: number): EDL {
  const MIN_SEG_LENGTH = 0.25;

  let hookStart = Math.max(0, Math.min(edl.hook.start, duration));
  let hookEnd = Math.max(hookStart + MIN_SEG_LENGTH, Math.min(edl.hook.end, duration));

  hookStart = Math.round(hookStart * 1000) / 1000;
  hookEnd = Math.round(hookEnd * 1000) / 1000;

  const sanitizedSegments = edl.segments
    .filter((seg) => {
      const start = Math.max(0, Math.min(seg.start, duration));
      const end = Math.max(start + MIN_SEG_LENGTH, Math.min(seg.end, duration));
      return end - start >= MIN_SEG_LENGTH;
    })
    .map((seg) => {
      let start = Math.max(0, Math.min(seg.start, duration));
      let end = Math.max(start + MIN_SEG_LENGTH, Math.min(seg.end, duration));
      start = Math.round(start * 1000) / 1000;
      end = Math.round(end * 1000) / 1000;
      return { ...seg, start, end };
    });

  return {
    ...edl,
    hook: { ...edl.hook, start: hookStart, end: hookEnd },
    segments: sanitizedSegments,
  };
}

function calculateKeptSeconds(edl: EDL): number {
  const hookSec = edl.hook.end - edl.hook.start;
  const segmentsSec = edl.segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
  return Math.max(hookSec, 0.25) + segmentsSec;
}

function validateEDLThresholds(edl: EDL, duration: number): { valid: boolean; keptSec: number; reason?: string } {
  const keptSec = calculateKeptSeconds(edl);
  const minKeep = Math.max(15, Math.min(0.25 * duration, 60));

  const hookLen = edl.hook.end - edl.hook.start;
  if (hookLen < 1.0 || hookLen > 3.5) {
    return {
      valid: false,
      keptSec,
      reason: `Hook too ${hookLen < 1.0 ? "short" : "long"} (${hookLen.toFixed(2)}s)`,
    };
  }

  if (edl.segments.length + 1 < 2) {
    return { valid: false, keptSec, reason: "Fewer than 2 segments" };
  }

  if (keptSec < minKeep) {
    return { valid: false, keptSec, reason: `Too short: ${keptSec.toFixed(2)}s < ${minKeep.toFixed(2)}s` };
  }

  return { valid: true, keptSec };
}

function repairAgggressiveEDL(edl: EDL, duration: number): EDL {
  const validation = validateEDLThresholds(edl, duration);
  if (validation.valid) return edl;

  const minKeep = Math.max(15, Math.min(0.25 * duration, 60));
  const keptSec = validation.keptSec;
  const neededSec = minKeep - keptSec;

  let repairedEDL = { ...edl };
  if (edl.segments.length === 0 && neededSec > 0) {
    const backboneStart = edl.hook.end;
    const backboneEnd = Math.min(backboneStart + neededSec + 5, duration);
    if (backboneEnd - backboneStart >= 0.25) {
      repairedEDL = {
        ...edl,
        segments: [
          {
            start: backboneStart,
            end: backboneEnd,
            reason: "Auto-repair: backbone segment",
            score: 0.5,
          },
        ],
      };
    }
  } else if (neededSec > 0 && edl.segments.length > 0) {
    const lastSeg = edl.segments[edl.segments.length - 1];
    const extendedEnd = Math.min(lastSeg.end + neededSec, duration);
    repairedEDL = {
      ...edl,
      segments: [
        ...edl.segments.slice(0, -1),
        { ...lastSeg, end: extendedEnd, reason: "Extended for minimum length" },
      ],
    };
  }

  const newKept = calculateKeptSeconds(repairedEDL);
  if (newKept < minKeep && edl.segments.length === 0) {
    const backboneEnd = Math.min(Math.max(60, duration * 0.5), duration);
    repairedEDL = {
      ...edl,
      hook: { ...edl.hook, start: 0, end: Math.min(3, backboneEnd), reason: "Auto-repair: full video intro" },
      segments: [
        {
          start: Math.min(3, backboneEnd),
          end: backboneEnd,
          reason: "Auto-repair: backbone",
          score: 0.5,
        },
      ],
    };
  }

  return repairedEDL;
}

function mergeAndCapSegments(segments: EDL["segments"], maxSegments = 25) {
  const MIN_SEG = 0.8;
  const MERGE_GAP = 0.4;

  const sorted = segments
    .map((seg) => ({ ...seg }))
    .sort((a, b) => a.start - b.start)
    .filter((seg) => seg.end - seg.start >= MIN_SEG);

  const merged: typeof sorted = [];
  for (const seg of sorted) {
    const last = merged[merged.length - 1];
    if (last && seg.start - last.end < MERGE_GAP) {
      last.end = Math.max(last.end, seg.end);
      last.score = Math.max(last.score, seg.score);
      last.reason = last.reason || seg.reason;
    } else {
      merged.push(seg);
    }
  }

  if (merged.length <= maxSegments) return merged;

  return [...merged]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, maxSegments)
    .sort((a, b) => a.start - b.start);
}

function buildAudioFilter(soundEnhance: boolean) {
  if (!soundEnhance) return null;
  return "loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=60,alimiter,afftdn=nf=-20";
}

function buildFilterComplex(
  parts: Array<{ start: number; end: number }>,
  soundEnhance: boolean,
  watermark: boolean = false,
  exportQuality?: "720p" | "1080p" | "4k"
) {
  const filters: string[] = [];
  parts.forEach((part, index) => {
    filters.push(`[0:v]trim=start=${part.start}:end=${part.end},setpts=PTS-STARTPTS[v${index}]`);
    filters.push(`[0:a]atrim=start=${part.start}:end=${part.end},asetpts=PTS-STARTPTS[a${index}]`);
  });

  const concatInputs = parts.map((_, i) => `[v${i}][a${i}]`).join("");
  filters.push(`${concatInputs}concat=n=${parts.length}:v=1:a=1[v][a]`);

  // Apply export scaling if requested (preserve aspect ratio, set target height)
  let videoOut = "[v]";
  const targetHeight =
    exportQuality === "4k" ? 2160 : exportQuality === "1080p" ? 1080 : exportQuality === "720p" ? 720 : undefined;
  if (targetHeight) {
    filters.push(`[v]scale=-2:${targetHeight}:force_original_aspect_ratio=decrease[vscaled]`);
    videoOut = "[vscaled]";
  }

  // Add watermark overlay if required (drawtext: "AutoEditor" in bottom-right corner)
  if (watermark) {
    filters.push(
      `${videoOut}drawtext=text='AutoEditor':fontsize=20:fontcolor=white@0.4:x=w-tw-10:y=h-th-10:fontfile=/Windows/Fonts/arial.ttf[vout]`
    );
    videoOut = "[vout]";
  }

  const audioFilter = buildAudioFilter(soundEnhance);
  if (audioFilter) {
    filters.push(`[a]${audioFilter}[aout]`);
  }

  return { filterComplex: filters.join(";"), videoOut, audioOut: audioFilter ? "[aout]" : "[a]" };
}

async function validateOutputFile(
  outputPath: string,
  inputPath: string,
  expectedKeptSec: number
): Promise<{
  valid: boolean;
  outputSizeBytes: number;
  outputDurationSec?: number;
  inputSizeBytes: number;
  reason?: string;
}> {
  try {
    if (!fsSync.existsSync(outputPath)) {
      return { valid: false, outputSizeBytes: 0, inputSizeBytes: 0, reason: "Output file does not exist" };
    }

    const outputStats = fsSync.statSync(outputPath);
    const outputSizeBytes = outputStats.size;

    const inputStats = fsSync.statSync(inputPath);
    const inputSizeBytes = inputStats.size;

    if (outputSizeBytes < 5_000_000) {
      return {
        valid: false,
        outputSizeBytes,
        inputSizeBytes,
        reason: `Output too small: ${(outputSizeBytes / 1024 / 1024).toFixed(2)}MB < 5MB`,
      };
    }

    const minSizeForInput = Math.max(5_000_000, inputSizeBytes * 0.05);
    if (outputSizeBytes < minSizeForInput) {
      return {
        valid: false,
        outputSizeBytes,
        inputSizeBytes,
        reason: `Output too small vs input: ${(outputSizeBytes / 1024 / 1024).toFixed(2)}MB < ${(minSizeForInput / 1024 / 1024).toFixed(2)}MB (5% of input)`,
      };
    }

    let outputDurationSec: number | undefined;
    try {
      const metadata = await getVideoMetadata(outputPath);
      outputDurationSec = metadata.duration;

      const minDuration = expectedKeptSec * 0.9;
      if (outputDurationSec < minDuration) {
        return {
          valid: false,
          outputSizeBytes,
          outputDurationSec,
          inputSizeBytes,
          reason: `Output duration too short: ${outputDurationSec.toFixed(2)}s < ${minDuration.toFixed(2)}s (90% of ${expectedKeptSec.toFixed(2)}s expected)`,
        };
      }
    } catch (err) {
      console.warn(`[EDL Apply] Could not probe output duration:`, err);
      return {
        valid: false,
        outputSizeBytes,
        inputSizeBytes,
        reason: "Unable to probe output duration",
      };
    }

    return { valid: true, outputSizeBytes, outputDurationSec, inputSizeBytes };
  } catch (err) {
    return {
      valid: false,
      outputSizeBytes: 0,
      inputSizeBytes: 0,
      reason: `Validation error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function applyEDL(params: {
  inputPath: string;
  edl: EDL;
  outputPath: string;
  jobId: string;
  soundEnhance?: boolean;
  watermark?: boolean;
  exportQuality?: "720p" | "1080p" | "4k";
  onProgress?: (update: ProgressUpdate) => void;
}): Promise<ApplyEDLResult> {
  const {
    inputPath,
    edl,
    outputPath,
    jobId,
    soundEnhance = true,
    watermark = false,
    exportQuality,
    onProgress,
  } = params;

  try {
    const ffmpeg = resolveFfmpegPath();
    const renderStart = Date.now();
    console.log(`[EDL Apply] jobId=${jobId}`);

    console.log(`[EDL Apply] Probing input: ${inputPath}`);
    let videoDuration = edl.expectedChange.originalDurationSec;

    try {
      const metadata = await getVideoMetadata(inputPath);
      videoDuration = metadata.duration;
      const inputStats = fsSync.statSync(inputPath);
      console.log(`[EDL Apply] Input: ${videoDuration.toFixed(2)}s, ${(inputStats.size / 1024 / 1024).toFixed(2)}MB`);
    } catch (err) {
      console.warn(`[EDL Apply] Could not fully probe input:`, err);
    }

    let working = sanitizeEDL(edl, videoDuration);
    console.log(
      `[EDL Apply] Sanitized: hook ${working.hook.start.toFixed(3)}s-${working.hook.end.toFixed(3)}s, ${working.segments.length} segments`
    );

    const keptSec = calculateKeptSeconds(working);
    const validation = validateEDLThresholds(working, videoDuration);

    console.log(
      `[EDL Apply] Validation: keptSec=${keptSec.toFixed(2)}s, valid=${validation.valid}, reason='${validation.reason}'`
    );

    if (!validation.valid) {
      console.log(`[EDL Apply] EDL failed validation, attempting repair...`);
      const repaired = repairAgggressiveEDL(working, videoDuration);
      const repairedKeptSec = calculateKeptSeconds(repaired);
      console.log(`[EDL Apply] Repair: ${keptSec.toFixed(2)}s → ${repairedKeptSec.toFixed(2)}s`);
      working = repaired;
    }

    const mergedSegments = mergeAndCapSegments(working.segments, 25);
    if (mergedSegments.length < 2) {
      return {
        success: false,
        error: "No meaningful edits applied",
        details: "Segment count below minimum after merge/cap",
        usedEdl: working,
        originalDurationSec: videoDuration,
        finalDurationSec: calculateKeptSeconds(working),
        removedSec: Math.max(0, videoDuration - calculateKeptSeconds(working)),
      };
    }

    const finalKeptSec = calculateKeptSeconds({ ...working, segments: mergedSegments });
    const removedSec = Math.max(0, videoDuration - finalKeptSec);
    const minRemoved = Math.max(3, videoDuration * 0.05);
    const hookFromLater = working.hook.start > 3 || videoDuration < 10;

    if (removedSec < minRemoved || !hookFromLater) {
      return {
        success: false,
        error: "No meaningful edits applied",
        details: `removedSec=${removedSec.toFixed(2)}s, minRemoved=${minRemoved.toFixed(2)}s, hookStart=${working.hook.start.toFixed(2)}s, segments=${mergedSegments.length}`,
        usedEdl: working,
        originalDurationSec: videoDuration,
        finalDurationSec: finalKeptSec,
        removedSec,
      };
    }

    const parts = [
      { start: working.hook.start, end: working.hook.end },
      ...mergedSegments.map((seg) => ({ start: seg.start, end: seg.end })),
    ];

    const expectedOutputSec = parts.reduce((sum, part) => sum + (part.end - part.start), 0);
    const { filterComplex, videoOut, audioOut } = buildFilterComplex(parts, soundEnhance, watermark, exportQuality);
    const fastRender = process.env.FAST_RENDER === "1";
    const preset = fastRender ? "ultrafast" : "veryfast";
    const crf = fastRender ? "28" : "24";

    console.log(`[EDL Apply] Strategy=single-pass, segments=${parts.length}, preset=${preset}, crf=${crf}`);

    const args = [
      "-hide_banner",
      "-y",
      "-i",
      inputPath,
      "-filter_complex",
      filterComplex,
      "-map",
      videoOut,
      "-map",
      audioOut,
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      crf,
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      "-nostats",
      outputPath,
    ];

    try {
      await runCommandWithProgress(ffmpeg, args, {
        expectedDurationSec: expectedOutputSec,
        onProgress,
        stallTimeoutSec: 10,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const stderr = err && typeof err === "object" && "stderr" in err ? String((err as { stderr?: string }).stderr) : undefined;
      return {
        success: false,
        error: errMsg.includes("FFmpeg stalled") ? "FFmpeg stalled during final render" : "FFmpeg render failed",
        details: errMsg,
        stderr,
        usedEdl: working,
        originalDurationSec: videoDuration,
        finalDurationSec: expectedOutputSec,
        removedSec: Math.max(0, videoDuration - expectedOutputSec),
      };
    }

    const elapsedSec = (Date.now() - renderStart) / 1000;
    console.log(`[EDL Apply] Render end: ${elapsedSec.toFixed(2)}s elapsed`);

    const validationResult = await validateOutputFile(outputPath, inputPath, expectedOutputSec);
    if (!validationResult.valid) {
      return {
        success: false,
        error: "Output validation failed",
        details: validationResult.reason,
        usedEdl: working,
        originalDurationSec: videoDuration,
        finalDurationSec: expectedOutputSec,
        removedSec: Math.max(0, videoDuration - expectedOutputSec),
      };
    }

    const outputDuration = validationResult.outputDurationSec ?? expectedOutputSec;
    const durationDiff = Math.abs(outputDuration - videoDuration);
    const hookMoved = working.hook.start > 3;

    if (durationDiff < 3 && !hookMoved) {
      return {
        success: false,
        error: "No meaningful edits applied",
        details: `Output duration diff ${durationDiff.toFixed(2)}s and hookStart=${working.hook.start.toFixed(2)}s`,
        usedEdl: working,
        originalDurationSec: videoDuration,
        finalDurationSec: outputDuration,
        removedSec: Math.max(0, videoDuration - outputDuration),
      };
    }

    const outputStats = fsSync.statSync(outputPath);
    console.log(
      `[EDL Apply] ✓ Output valid: ${(outputStats.size / 1024 / 1024).toFixed(2)}MB, ${outputDuration.toFixed(2)}s`
    );

    const usedEdl: EDL = {
      ...working,
      segments: mergedSegments,
      expectedChange: {
        originalDurationSec: videoDuration,
        finalDurationSec: expectedOutputSec,
        totalRemovedSec: Math.max(0, videoDuration - expectedOutputSec),
      },
    };

    return {
      success: true,
      usedEdl,
      originalDurationSec: videoDuration,
      finalDurationSec: outputDuration,
      removedSec: Math.max(0, videoDuration - outputDuration),
      validationDetails: {
        keptSec: expectedOutputSec,
        segmentCount: mergedSegments.length,
        hookStart: working.hook.start,
        hookEnd: working.hook.end,
        outputSizeBytes: validationResult.outputSizeBytes,
        outputDurationSec: validationResult.outputDurationSec,
        inputSizeBytes: validationResult.inputSizeBytes,
        fallbackUsed: false,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[EDL Apply] Unexpected error:", errorMsg);
    return {
      success: false,
      error: "EDL application failed",
      details: errorMsg.substring(0, 2000),
    };
  }
}
