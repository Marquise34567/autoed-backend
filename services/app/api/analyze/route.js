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
const ffprobe_1 = require("@/lib/server/ffprobe");
const transcribe_1 = require("@/lib/analyze/transcribe");
const silence_1 = require("@/lib/analyze/silence");
const candidates_1 = require("@/lib/analyze/candidates");
const scoring_1 = require("@/lib/analyze/scoring");
const builder_1 = require("@/lib/edl/builder");
const jobStore_1 = require("@/lib/server/jobStore");
const resolve_1 = require("@/lib/ffmpeg/resolve");
const runBin_1 = require("@/lib/runBin");
const firebaseAdmin_1 = require("@/lib/firebaseAdmin");
const authServer_1 = require("@/lib/authServer");
exports.runtime = "nodejs";
async function POST(request) {
    let jobId = "";
    let originalFileName = "";
    let inputPath = "";
    let clipLengths = [15, 30, 45, 60];
    const requestId = (0, crypto_1.randomUUID)();
    // OUTER TRY/CATCH: Guarantee we ALWAYS return JSON
    try {
        const contentType = request.headers.get("content-type") ?? "";
        const contentLength = request.headers.get("content-length") ?? "unknown";
        console.log(`[analyze:${requestId}] ${request.method} content-type=${contentType} content-length=${contentLength}`);
        // AUTH: For development selftest mode we allow running without auth.
        // Otherwise require a valid Firebase ID token.
        // We'll parse the body below and enforce auth conditionally after we know if this is a selftest.
        // PREFLIGHT CHECK: Verify FFmpeg/FFprobe are available
        try {
            const bins = (0, resolve_1.checkBinaries)();
            console.log("[preflight] FFmpeg:", bins.ffmpeg);
            console.log("[preflight] FFprobe:", bins.ffprobe);
        }
        catch (error) {
            console.error("[preflight] Binary check failed:", error);
            return server_1.NextResponse.json({
                error: "FFmpeg/FFprobe not found",
                details: error instanceof Error ? error.message : "Install FFmpeg",
                installInstructions: "On Windows: winget install Gyan.FFmpeg",
            }, { status: 500 });
        }
        if (contentType.includes("multipart/form-data")) {
            return server_1.NextResponse.json({
                error: "Multipart uploads not supported. Upload to storage then send { videoPath } JSON.",
            }, { status: 415 });
        }
        if (contentType.includes("application/json")) {
            let body = null;
            try {
                body = (await request.json());
            }
            catch (error) {
                console.error(`[analyze:${requestId}] Invalid JSON:`, error);
                return server_1.NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
            }
            // Enforce auth except when running dev-only selftest
            if (!(body?.selftest && process.env.NODE_ENV === 'development')) {
                try {
                    await (0, authServer_1.requireAuth)(request);
                }
                catch (e) {
                    return e;
                }
            }
            if (body?.selftest) {
                if (process.env.NODE_ENV !== "development") {
                    return server_1.NextResponse.json({ error: "Selftest not allowed", details: "Dev-only endpoint" }, { status: 403 });
                }
                if (!body.path) {
                    return server_1.NextResponse.json({ error: "Missing path", details: "Selftest path is required" }, { status: 400 });
                }
                inputPath = path_1.default.resolve(process.cwd(), body.path);
                originalFileName = path_1.default.basename(inputPath);
                if (Array.isArray(body.clipLengths)) {
                    clipLengths = body.clipLengths.map((value) => Number(value));
                }
                else if (typeof body.clipLengths === "string") {
                    clipLengths = body.clipLengths
                        .split(",")
                        .map((value) => Number(value.trim()));
                }
                console.log("[selftest] Using inputPath:", inputPath);
            }
            else if (body?.videoPath) {
                // NEW: Handle direct storage upload flow
                if (typeof body.videoPath !== "string" || !body.videoPath.trim()) {
                    return server_1.NextResponse.json({ error: "Missing videoPath", details: "videoPath must be a non-empty string" }, { status: 400 });
                }
                console.log("[storage] Downloading video from storage path:", body.videoPath);
                if (Array.isArray(body.clipLengths)) {
                    clipLengths = body.clipLengths.map((value) => Number(value));
                }
                else if (typeof body.clipLengths === "string") {
                    clipLengths = body.clipLengths
                        .split(",")
                        .map((value) => Number(value.trim()));
                }
                try {
                    const bucket = (0, firebaseAdmin_1.getBucket)();
                    const file = bucket.file(body.videoPath);
                    const [exists] = await file.exists();
                    if (!exists) {
                        return server_1.NextResponse.json({ error: 'Video not found in storage', details: body.videoPath }, { status: 404 });
                    }
                    const [buffer] = await file.download();
                    jobId = (0, crypto_1.randomUUID)();
                    originalFileName = path_1.default.basename(body.videoPath);
                    console.log('[storage] Downloaded video, size:', buffer.length, 'bytes');
                    const uploadDir = path_1.default.resolve(process.cwd(), 'tmp', 'uploads');
                    await fs_1.promises.mkdir(uploadDir, { recursive: true });
                    const safeName = originalFileName.replace(/[^a-z0-9.\-_]/gi, '_');
                    inputPath = path_1.default.resolve(uploadDir, `${jobId}-${safeName}`);
                    await fs_1.promises.writeFile(inputPath, buffer);
                    console.log('[storage] File written successfully to', inputPath);
                }
                catch (error) {
                    console.error('[storage] Error downloading/processing video:', error);
                    return server_1.NextResponse.json({ error: 'Failed to download video', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
                }
            }
            else {
                return server_1.NextResponse.json({ error: "Invalid request", details: "Expected JSON with videoPath or selftest mode" }, { status: 400 });
            }
        }
        else {
            return server_1.NextResponse.json({
                error: "Unsupported content type",
                details: "Send application/json with { videoPath }",
            }, { status: 415 });
        }
        if (!jobId) {
            jobId = (0, crypto_1.randomUUID)();
            console.log("[analyze] Created jobId:", jobId);
        }
        const transcriptDir = path_1.default.resolve(process.cwd(), "tmp", "transcripts", jobId);
        // STEP 2: VERIFY FILE EXISTS
        console.log("[validation] Checking if file exists on disk...");
        if (!fsSync.existsSync(inputPath)) {
            console.error("[validation] File does not exist after write!");
            return server_1.NextResponse.json({
                error: "File validation failed",
                details: `Input video not found at ${inputPath}`,
                path: inputPath
            }, { status: 500 });
        }
        const fileStats = await fs_1.promises.stat(inputPath);
        console.log("[validation] File exists, size:", fileStats.size, "bytes");
        if (fileStats.size === 0) {
            console.error("[validation] File is empty!");
            return server_1.NextResponse.json({
                error: "File validation failed",
                details: "Uploaded video file is empty (0 bytes)",
                path: inputPath
            }, { status: 400 });
        }
        // STEP 3: FFPROBE PRE-FLIGHT TEST
        console.log("[validation] Running FFprobe pre-flight test...");
        try {
            const { resolveFfprobePath } = await Promise.resolve().then(() => __importStar(require("@/lib/ffmpeg/resolve")));
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
            const result = await (0, runBin_1.runBin)(ffprobePath, args);
            if (result.code !== 0) {
                console.error("[validation] FFprobe pre-flight FAILED with code:", result.code);
                return server_1.NextResponse.json({
                    error: "Analyze failed",
                    details: "ffprobe failed",
                    exitCode: result.code,
                    stderr: result.stderr.slice(0, 3000),
                    stdout: result.stdout.slice(0, 3000),
                    inputPath,
                    binPath: ffprobePath,
                    args,
                }, { status: 500 });
            }
            const parsed = JSON.parse(result.stdout);
            const format = parsed?.format ?? {};
            const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
            const videoStream = streams.find((s) => s?.codec_type === "video");
            const duration = Number(format?.duration ?? 0);
            const width = Number(videoStream?.width ?? 0);
            const height = Number(videoStream?.height ?? 0);
            console.log("[validation] FFprobe test successful");
            console.log("[validation] Duration:", duration, "Width:", width, "Height:", height);
        }
        catch (ffprobeError) {
            console.error("[validation] FFprobe pre-flight FAILED:");
            console.error(ffprobeError);
            const errorMessage = ffprobeError instanceof Error ? ffprobeError.message : String(ffprobeError);
            return server_1.NextResponse.json({
                error: "Analyze failed",
                details: "ffprobe invocation error",
                message: errorMessage,
                inputPath,
            }, { status: 500 });
        }
        console.log("[analyze] All pre-flight checks passed, creating job...");
        const job = (0, jobStore_1.createJob)({
            id: jobId,
            filePath: inputPath,
            createdAt: Date.now(),
            duration: 0,
            transcript: [],
            candidates: [],
            clips: [],
            status: 'queued',
            stage: "Queued",
            message: "Upload complete",
            logs: [`Uploaded ${originalFileName || path_1.default.basename(inputPath)}`],
        });
        (0, jobStore_1.updateJob)(jobId, {
            status: 'processing',
            stage: "Analyzing",
            message: "Transcribing and scoring",
        });
        console.log("Getting video metadata...");
        const metadata = await (0, ffprobe_1.getVideoMetadata)(inputPath);
        console.log("Duration:", metadata.duration);
        (0, jobStore_1.updateJob)(jobId, { duration: metadata.duration });
        console.log("Starting transcription...");
        const transcript = await (0, transcribe_1.transcribeWithWhisper)(inputPath, transcriptDir);
        console.log("Transcription complete, segments:", transcript.length);
        console.log("Detecting silence intervals...");
        const silenceIntervals = await (0, silence_1.detectSilenceIntervals)(inputPath);
        const candidates = (0, candidates_1.generateCandidateSegments)(metadata.duration, clipLengths, transcript);
        const scored = (0, scoring_1.scoreCandidates)(candidates, transcript, silenceIntervals).map((candidate) => ({
            ...candidate,
        }));
        console.log("Building EDL (Edit Decision List)...");
        const edl = (0, builder_1.buildEDL)({
            duration: metadata.duration,
            transcript,
            silenceIntervals,
            aggressiveness: "high",
        });
        console.log(`EDL: Hook ${edl.hook.start.toFixed(2)}s-${edl.hook.end.toFixed(2)}s, ${edl.segments.length} segments`);
        console.log(`Expected output duration: ${edl.expectedChange.finalDurationSec.toFixed(2)}s (removed ${edl.expectedChange.totalRemovedSec.toFixed(2)}s)`);
        const validation = (0, builder_1.validateEDL)(edl);
        if (!validation.valid) {
            console.warn("[WARNING] EDL validation issues:", validation.errors);
            // Don't fail, but log warnings
            validation.errors.forEach((err) => (0, jobStore_1.appendJobLog)(jobId, `Warning: ${err}`));
        }
        const improvements = [
            `Hook from ${edl.hook.start.toFixed(1)}s`,
            `Removed ${edl.expectedChange.totalRemovedSec.toFixed(1)}s`,
            `${edl.segments.length} high-value segments kept`,
        ];
        const hookStart = edl.hook.start;
        const hookEnd = edl.hook.end;
        const chosenStart = hookStart;
        const chosenEnd = hookEnd;
        const outputDir = path_1.default.join(process.cwd(), "public", "outputs", jobId);
        await fs_1.promises.mkdir(outputDir, { recursive: true });
        // Save EDL JSON
        const edlPath = path_1.default.join(outputDir, "edl.json");
        await fs_1.promises.writeFile(edlPath, JSON.stringify(edl, null, 2));
        console.log("EDL saved to:", edlPath);
        // Save analysis summary
        const analysisPath = path_1.default.join(outputDir, "analysis.json");
        await fs_1.promises.writeFile(analysisPath, JSON.stringify({
            chosenStart,
            chosenEnd,
            hookStart,
            hookEnd,
            improvements,
            edl,
        }, null, 2));
        (0, jobStore_1.updateJob)(jobId, {
            transcript,
            candidates: scored,
            status: 'processing',
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
        (0, jobStore_1.appendJobLog)(jobId, `Analyzed ${originalFileName || path_1.default.basename(inputPath)}`);
        (0, jobStore_1.appendJobLog)(jobId, `Duration ${metadata.duration.toFixed(2)}s`);
        (0, jobStore_1.updateJob)(jobId, {
            status: 'processing',
            stage: "Draft render",
            message: "Building preview",
        });
        console.log("=== Analyze complete, READY FOR GENERATE ===");
        console.log("Job analysis done. Waiting for generate phase.");
        (0, jobStore_1.updateJob)(jobId, {
            status: 'processing',
            stage: "Audio enhancement",
            message: "Preparing for final render",
        });
        return server_1.NextResponse.json({
            jobId: job.id,
            duration: metadata.duration,
            transcript,
            candidates: scored,
        });
    }
    catch (error) {
        console.error("=== ANALYZE ROUTE ERROR ===");
        console.error("Error type:", error?.constructor?.name);
        console.error("Error message:", error instanceof Error ? error.message : String(error));
        console.error("Stack trace:");
        console.error(error instanceof Error ? error.stack : "No stack trace available");
        console.error("===========================");
        // Extract error details
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        const errorWithIO = error;
        if (jobId) {
            try {
                (0, jobStore_1.updateJob)(jobId, {
                    status: 'failed',
                    stage: "Failed",
                    message: "Analyze failed",
                    error: errorMessage,
                });
                (0, jobStore_1.appendJobLog)(jobId, `Failed: ${errorMessage}`);
            }
            catch (updateError) {
                console.error("[error] Failed to update job:", updateError);
            }
        }
        // GUARANTEED JSON RESPONSE - This must NEVER fail
        return server_1.NextResponse.json({
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
        }, { status: 500 });
    }
}
