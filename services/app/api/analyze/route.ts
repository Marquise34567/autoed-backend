import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import * as fsSync from "fs";
import { randomUUID } from "crypto";
import { getVideoMetadata } from "@/lib/server/ffprobe";
import { transcribeWithWhisper } from "@/lib/analyze/transcribe";
import { detectSilenceIntervals } from "@/lib/analyze/silence";
import { generateCandidateSegments } from "@/lib/analyze/candidates";
import { scoreCandidates } from "@/lib/analyze/scoring";
import { buildEDL, validateEDL } from "@/lib/edl/builder";
import { createJob, updateJob, appendJobLog } from "@/lib/server/jobStore";
import { checkBinaries } from "@/lib/ffmpeg/resolve";
import { runBin } from "@/lib/runBin";
import { getBucket } from "@/lib/firebaseAdmin";
import { requireAuth } from '@/lib/authServer'

export const runtime = "nodejs";

export async function POST(request: Request) {
  let jobId = "";
  let originalFileName = "";
  let inputPath = "";
  let clipLengths: number[] = [15, 30, 45, 60];
  const requestId = randomUUID();
  
  // OUTER TRY/CATCH: Guarantee we ALWAYS return JSON
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const contentLength = request.headers.get("content-length") ?? "unknown";
    console.log(
      `[analyze:${requestId}] ${request.method} content-type=${contentType} content-length=${contentLength}`
    );
    
    // AUTH: For development selftest mode we allow running without auth.
    // Otherwise require a valid Firebase ID token.
    // We'll parse the body below and enforce auth conditionally after we know if this is a selftest.
    
    // PREFLIGHT CHECK: Verify FFmpeg/FFprobe are available
    try {
      const bins = checkBinaries();
      console.log("[preflight] FFmpeg:", bins.ffmpeg);
      console.log("[preflight] FFprobe:", bins.ffprobe);
    } catch (error) {
      console.error("[preflight] Binary check failed:", error);
      return NextResponse.json(
        {
          error: "FFmpeg/FFprobe not found",
          details: error instanceof Error ? error.message : "Install FFmpeg",
          installInstructions: "On Windows: winget install Gyan.FFmpeg",
        },
        { status: 500 }
      );
    }
    
    if (contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        {
          error: "Multipart uploads not supported. Upload to storage then send { videoPath } JSON.",
        },
        { status: 415 }
      );
    }

    if (contentType.includes("application/json")) {
      let body: {
        selftest?: boolean;
        path?: string;
        videoPath?: string;
        clipLengths?: number[] | string;
      } | null = null;
      try {
        body = (await request.json()) as {
          selftest?: boolean;
          path?: string;
          videoPath?: string;
          clipLengths?: number[] | string;
        };
      } catch (error) {
        console.error(`[analyze:${requestId}] Invalid JSON:`, error);
        return NextResponse.json(
          { error: "Invalid JSON body" },
          { status: 400 }
        );
      }

      // Enforce auth except when running dev-only selftest
      if (!(body?.selftest && process.env.NODE_ENV === 'development')) {
        try {
          await requireAuth(request)
        } catch (e) {
          return e as Response
        }
      }

      if (body?.selftest) {
        if (process.env.NODE_ENV !== "development") {
          return NextResponse.json(
            { error: "Selftest not allowed", details: "Dev-only endpoint" },
            { status: 403 }
          );
        }

        if (!body.path) {
          return NextResponse.json(
            { error: "Missing path", details: "Selftest path is required" },
            { status: 400 }
          );
        }

        inputPath = path.resolve(process.cwd(), body.path);
        originalFileName = path.basename(inputPath);

        if (Array.isArray(body.clipLengths)) {
          clipLengths = body.clipLengths.map((value) => Number(value));
        } else if (typeof body.clipLengths === "string") {
          clipLengths = body.clipLengths
            .split(",")
            .map((value) => Number(value.trim()));
        }

        console.log("[selftest] Using inputPath:", inputPath);
      } else if (body?.videoPath) {
        // NEW: Handle direct storage upload flow
        if (typeof body.videoPath !== "string" || !body.videoPath.trim()) {
          return NextResponse.json(
            { error: "Missing videoPath", details: "videoPath must be a non-empty string" },
            { status: 400 }
          );
        }

        console.log("[storage] Downloading video from storage path:", body.videoPath);

        if (Array.isArray(body.clipLengths)) {
          clipLengths = body.clipLengths.map((value) => Number(value));
        } else if (typeof body.clipLengths === "string") {
          clipLengths = body.clipLengths
            .split(",")
            .map((value) => Number(value.trim()));
        }

          try {
            const bucket = getBucket()
            const file = bucket.file(body.videoPath)
            const [exists] = await file.exists()
            if (!exists) {
              return NextResponse.json({ error: 'Video not found in storage', details: body.videoPath }, { status: 404 })
            }
            const [buffer] = await file.download()
            jobId = randomUUID()
            originalFileName = path.basename(body.videoPath)
            console.log('[storage] Downloaded video, size:', buffer.length, 'bytes')

            const uploadDir = path.resolve(process.cwd(), 'tmp', 'uploads')
            await fs.mkdir(uploadDir, { recursive: true })
            const safeName = originalFileName.replace(/[^a-z0-9.\-_]/gi, '_')
            inputPath = path.resolve(uploadDir, `${jobId}-${safeName}`)
            await fs.writeFile(inputPath, buffer)
            console.log('[storage] File written successfully to', inputPath)
          } catch (error) {
            console.error('[storage] Error downloading/processing video:', error)
            return NextResponse.json({ error: 'Failed to download video', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
          }
      } else {
        return NextResponse.json(
          { error: "Invalid request", details: "Expected JSON with videoPath or selftest mode" },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        {
          error: "Unsupported content type",
          details: "Send application/json with { videoPath }",
        },
        { status: 415 }
      );
    }

    if (!jobId) {
      jobId = randomUUID();
      console.log("[analyze] Created jobId:", jobId);
    }

    const transcriptDir = path.resolve(process.cwd(), "tmp", "transcripts", jobId);
    
    // STEP 2: VERIFY FILE EXISTS
    console.log("[validation] Checking if file exists on disk...");
    if (!fsSync.existsSync(inputPath)) {
      console.error("[validation] File does not exist after write!");
      return NextResponse.json(
        {
          error: "File validation failed",
          details: `Input video not found at ${inputPath}`,
          path: inputPath
        },
        { status: 500 }
      );
    }
    
    const fileStats = await fs.stat(inputPath);
    console.log("[validation] File exists, size:", fileStats.size, "bytes");
    
    if (fileStats.size === 0) {
      console.error("[validation] File is empty!");
      return NextResponse.json(
        {
          error: "File validation failed",
          details: "Uploaded video file is empty (0 bytes)",
          path: inputPath
        },
        { status: 400 }
      );
    }
    
    // STEP 3: FFPROBE PRE-FLIGHT TEST
    console.log("[validation] Running FFprobe pre-flight test...");
    try {
      const { resolveFfprobePath } = await import("@/lib/ffmpeg/resolve");
      const ffprobePath = resolveFfprobePath();

      const args = [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        inputPath,
      ];

      console.log("[ffprobe] bin:", ffprobePath);
      console.log("[ffprobe] args:", args);

      const result = await runBin(ffprobePath, args);

      if (result.code !== 0) {
        console.error("[validation] FFprobe pre-flight FAILED with code:", result.code);
        return NextResponse.json(
          {
            error: "Analyze failed",
            details: "ffprobe failed",
            exitCode: result.code,
            stderr: result.stderr.slice(0, 3000),
            stdout: result.stdout.slice(0, 3000),
            inputPath,
            binPath: ffprobePath,
            args,
          },
          { status: 500 }
        );
      }

      const parsed = JSON.parse(result.stdout) as {
        format?: Record<string, unknown>;
        streams?: Array<Record<string, unknown>>;
      };
      const format = parsed?.format ?? {};
      const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
      const videoStream = streams.find(
        (s: Record<string, unknown>) => s?.codec_type === "video"
      );
      const duration = Number(format?.duration ?? 0);
      const width = Number(videoStream?.width ?? 0);
      const height = Number(videoStream?.height ?? 0);

      console.log("[validation] FFprobe test successful");
      console.log("[validation] Duration:", duration, "Width:", width, "Height:", height);
    } catch (ffprobeError) {
      console.error("[validation] FFprobe pre-flight FAILED:");
      console.error(ffprobeError);

      const errorMessage = ffprobeError instanceof Error ? ffprobeError.message : String(ffprobeError);

      return NextResponse.json(
        {
          error: "Analyze failed",
          details: "ffprobe invocation error",
          message: errorMessage,
          inputPath,
        },
        { status: 500 }
      );
    }

    console.log("[analyze] All pre-flight checks passed, creating job...");
    const job = createJob({
      id: jobId,
      filePath: inputPath,
      createdAt: Date.now(),
      duration: 0,
      transcript: [],
      candidates: [],
      clips: [],
      status: "QUEUED",
      stage: "Queued",
      message: "Upload complete",
      logs: [`Uploaded ${originalFileName || path.basename(inputPath)}`],
    });

    updateJob(jobId, {
      status: "ANALYZING",
      stage: "Analyzing",
      message: "Transcribing and scoring",
    });
    
    console.log("Getting video metadata...");
    const metadata = await getVideoMetadata(inputPath);
    console.log("Duration:", metadata.duration);
    
    updateJob(jobId, { duration: metadata.duration });
    
    console.log("Starting transcription...");
    const transcript = await transcribeWithWhisper(inputPath, transcriptDir);
    console.log("Transcription complete, segments:", transcript.length);
    
    console.log("Detecting silence intervals...");
    const silenceIntervals = await detectSilenceIntervals(inputPath);
    
    const candidates = generateCandidateSegments(
      metadata.duration,
      clipLengths,
      transcript
    );
    const scored = scoreCandidates(candidates, transcript, silenceIntervals).map(
      (candidate) => ({
        ...candidate,
      })
    );

    console.log("Building EDL (Edit Decision List)...");
    const edl = buildEDL({
      duration: metadata.duration,
      transcript,
      silenceIntervals,
      aggressiveness: "high",
    });

    console.log(`EDL: Hook ${edl.hook.start.toFixed(2)}s-${edl.hook.end.toFixed(2)}s, ${edl.segments.length} segments`);
    console.log(`Expected output duration: ${edl.expectedChange.finalDurationSec.toFixed(2)}s (removed ${edl.expectedChange.totalRemovedSec.toFixed(2)}s)`);

    const validation = validateEDL(edl);
    if (!validation.valid) {
      console.warn("[WARNING] EDL validation issues:", validation.errors);
      // Don't fail, but log warnings
      validation.errors.forEach((err) => appendJobLog(jobId, `Warning: ${err}`));
    }

    const improvements: string[] = [
      `Hook from ${edl.hook.start.toFixed(1)}s`,
      `Removed ${edl.expectedChange.totalRemovedSec.toFixed(1)}s`,
      `${edl.segments.length} high-value segments kept`,
    ];
    const hookStart = edl.hook.start;
    const hookEnd = edl.hook.end;
    const chosenStart = hookStart;
    const chosenEnd = hookEnd;

    const outputDir = path.join(process.cwd(), "public", "outputs", jobId);
    await fs.mkdir(outputDir, { recursive: true });
    
    // Save EDL JSON
    const edlPath = path.join(outputDir, "edl.json");
    await fs.writeFile(edlPath, JSON.stringify(edl, null, 2));
    console.log("EDL saved to:", edlPath);
    
    // Save analysis summary
    const analysisPath = path.join(outputDir, "analysis.json");
    await fs.writeFile(
      analysisPath,
      JSON.stringify(
        {
          chosenStart,
          chosenEnd,
          hookStart,
          hookEnd,
          improvements,
          edl,
        },
        null,
        2
      )
    );

    updateJob(jobId, {
      transcript,
      candidates: scored,
      status: "ENHANCING_AUDIO",
      stage: "Enhancing audio",
      message: "Preparing sound enhancements",
      details: {
        chosenStart,
        chosenEnd,
        hookStart,
        improvements,
        edl,
      },
    });
    appendJobLog(jobId, `Analyzed ${originalFileName || path.basename(inputPath)}`);
    appendJobLog(jobId, `Duration ${metadata.duration.toFixed(2)}s`);

    updateJob(jobId, {
      status: "RENDERING_DRAFT",
      stage: "Draft render",
      message: "Building preview",
    });

    console.log("=== Analyze complete, READY FOR GENERATE ===");
    console.log("Job analysis done. Waiting for generate phase.");
    
    updateJob(jobId, {
      status: "ENHANCING_AUDIO",
      stage: "Audio enhancement",
      message: "Preparing for final render",
    });

    return NextResponse.json({
      jobId: job.id,
      duration: metadata.duration,
      transcript,
      candidates: scored,
    });
  } catch (error) {
    console.error("=== ANALYZE ROUTE ERROR ===");
    console.error("Error type:", error?.constructor?.name);
    console.error("Error message:", error instanceof Error ? error.message : String(error));
    console.error("Stack trace:");
    console.error(error instanceof Error ? error.stack : "No stack trace available");
    console.error("===========================");
    
    // Extract error details
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorWithIO = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
      command?: string;
      args?: string[];
    };
    
    if (jobId) {
      try {
        updateJob(jobId, {
          status: "FAILED",
          stage: "Failed",
          message: "Analyze failed",
          error: errorMessage,
        });
        appendJobLog(jobId, `Failed: ${errorMessage}`);
      } catch (updateError) {
        console.error("[error] Failed to update job:", updateError);
      }
    }
    
    // GUARANTEED JSON RESPONSE - This must NEVER fail
    return NextResponse.json(
      {
        error: "Analyze failed",
        details: errorMessage,
        jobId: jobId || null,
        timestamp: new Date().toISOString(),
        ...(typeof errorWithIO.code === "number" ? { exitCode: errorWithIO.code } : {}),
        ...(errorWithIO.stderr ? { stderr: errorWithIO.stderr.slice(0, 3000) } : {}),
        ...(errorWithIO.stdout ? { stdout: errorWithIO.stdout.slice(0, 3000) } : {}),
        ...(errorWithIO.command ? { binPath: errorWithIO.command } : {}),
        ...(errorWithIO.args ? { args: errorWithIO.args } : {}),
        ...(process.env.NODE_ENV === "development" && errorStack ? { stack: errorStack } : {}),
      },
      { status: 500 }
    );
  }
}
