import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createJob, updateJob, appendJobLog } from "@/lib/jobs";
import path from "path";
import fs from "fs";
import { getBucket } from "@/lib/firebaseAdmin";
import normalizeToMp4 from "@/lib/ffmpeg/normalize";
import { probeDurationSec, detectSilenceSegments, selectBoringCuts, analyzeVideo } from '@/lib/videoAnalysis';
import { renderEditedVideo } from '@/lib/ffmpeg/renderEdited';

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
    }

    const body = await request.json();
    const storagePath = typeof body?.path === "string" ? body.path : null;
    if (!storagePath) {
      return NextResponse.json({ error: "Missing path" }, { status: 400 });
    }

    const jobId = randomUUID();
    // try to infer uid from storagePath (expect uploads/{uid}/... or {uid}/...)
    const parts = storagePath.split('/');
    const inferredUid = parts[0] === 'uploads' && parts[1] ? parts[1] : parts[0] || 'unknown';

    const job = await createJob({
      id: jobId,
      uid: inferredUid,
      phase: 'UPLOADING',
      overallProgress: 0,
      overallEtaSec: null,
      message: 'Upload complete',
      createdAt: Date.now(),
      objectPathOriginal: storagePath,
      logs: [`Created job for ${storagePath}`],
    } as any);

    // Start async pipeline; return jobId immediately so client can open SSE
    (async () => {
      try {
        // Parse UID from storage path (expect uploads/{uid}/... or {uid}/...)
        const parts = storagePath.split('/');
        const uid = parts[0] === 'uploads' && parts[1] ? parts[1] : (parts[0] || 'unknown');

        await updateJob(jobId, { phase: 'NORMALIZING', overallProgress: 0.05, overallEtaSec: 30, message: 'Normalizing uploaded video' });
        appendJobLog(jobId, 'Starting normalization pipeline');

        // Download file from Firebase Storage
        const bucket = getBucket();
        const remoteFile = bucket.file(storagePath);
        const [exists] = await remoteFile.exists();
        if (!exists) {
            await updateJob(jobId, { phase: 'ERROR', message: 'Source file not found', error: 'Source file missing' });
          appendJobLog(jobId, `Source file not found: ${storagePath}`);
          return;
        }

        const uploadDir = path.resolve(process.cwd(), 'tmp', 'uploads');
        fs.mkdirSync(uploadDir, { recursive: true });
        const safeName = path.basename(storagePath).replace(/[^a-z0-9.\-_]/gi, '_');
        const tmpInput = path.resolve(uploadDir, `${jobId}-${safeName}`);

        // Download into temp file
        appendJobLog(jobId, `Downloading ${storagePath} to ${tmpInput}`);
        await remoteFile.download({ destination: tmpInput });
        await updateJob(jobId, { overallProgress: 0.12, overallEtaSec: 40, message: 'Downloaded input' });

        // Normalize to MP4
        const normalizedLocal = path.resolve(uploadDir, `${jobId}-normalized.mp4`);
        const normRes = await normalizeToMp4(tmpInput, normalizedLocal, jobId);
        if (!normRes || !normRes.success) {
          await updateJob(jobId, { phase: 'ERROR', message: 'Normalization failed', error: normRes?.error || 'Normalization failed' });
          appendJobLog(jobId, `Normalization failed: ${JSON.stringify(normRes).slice(0,200)}`);
          return;
        }

        await updateJob(jobId, { phase: 'ANALYZING', overallProgress: 0.25, overallEtaSec: 60, message: 'Uploading normalized input' });

        // Upload normalized file back to storage under normalized/{uid}/{jobId}/input.mp4
        const destPath = `normalized/${uid}/${jobId}/input.mp4`;
        const destFile = bucket.file(destPath);
        await destFile.save(fs.readFileSync(normalizedLocal), { resumable: false, contentType: 'video/mp4' });
        appendJobLog(jobId, `Uploaded normalized input to ${destPath}`);
        await updateJob(jobId, { overallProgress: 0.3, overallEtaSec: 50, message: 'Starting analysis', objectPathNormalized: destPath });

        // Perform local analysis using ffprobe/ffmpeg (no network fetches)
        try {
          await updateJob(jobId, { phase: 'ANALYZING', overallProgress: 0.01, overallEtaSec: 30, message: 'Analyzing video (local)'});
          appendJobLog(jobId, `Probing duration for ${normalizedLocal}`);
          const durationSec = await probeDurationSec(normalizedLocal);
          appendJobLog(jobId, `Duration: ${durationSec}s`);
          await updateJob(jobId, { durationSec, overallProgress: 0.15, overallEtaSec: Math.max(10, Math.round(durationSec * 0.25)), message: 'Detecting silence' });

          const silenceSegments = await detectSilenceSegments(normalizedLocal);
          appendJobLog(jobId, `Detected ${silenceSegments.length} silence segments`);
          await updateJob(jobId, { silenceSegments, overallProgress: 0.22, overallEtaSec: Math.max(10, Math.round(durationSec * 0.2)), message: 'Analyzing for hooks' });

          // Analyze video for hook candidates (energy + silence based)
          await updateJob(jobId, { phase: 'HOOK_SELECTING', overallProgress: 0.24, message: 'Selecting hook' });
          const analysis = await analyzeVideo(normalizedLocal);
          appendJobLog(jobId, `Found ${analysis.hookCandidates.length} hook candidates`);
          const hook = (analysis.hookCandidates && analysis.hookCandidates.length) ? analysis.hookCandidates[0] : { start: 0, end: Math.min(7, Math.floor(durationSec)) };
          await updateJob(jobId, { hook, overallProgress: 0.26, message: 'Hook selected' });

          // Select boring cuts, but ensure we never cut the original hook region
          await updateJob(jobId, { phase: 'CUT_SELECTING', overallProgress: 0.28, message: 'Selecting cuts' });
          let cuts = selectBoringCuts(durationSec, silenceSegments);
          // remove any cut that overlaps the original hook (hook.start..hook.end)
          cuts = cuts.filter(c => (c.end <= hook.start) || (c.start >= hook.end));
          appendJobLog(jobId, `Selected ${cuts.length} boring cuts, totalRemovedSec=${cuts.reduce((s,c)=>s+(c.end-c.start),0)}`);
          await updateJob(jobId, { cuts, overallProgress: 0.3, overallEtaSec: Math.max(5, Math.round(durationSec * 0.15)) });

          // Pacing pass placeholder (could micro-trim)
          await updateJob(jobId, { phase: 'PACING', overallProgress: 0.35, message: 'Applying pacing adjustments' });

          // Continue to rendering
          await updateJob(jobId, { phase: 'RENDERING', overallProgress: 0.45, message: 'Rendering final video' });

          // Render final using selected hook + cuts
          await updateJob(jobId, { phase: 'RENDERING', overallProgress: 0.45, message: 'Rendering final video' });
          const renderLocal = path.resolve(process.cwd(), 'tmp', 'renders', `${jobId}-final.mp4`);
          fs.mkdirSync(path.dirname(renderLocal), { recursive: true });
          try {
            await renderEditedVideo(normalizedLocal, { start: hook.start, end: hook.end }, cuts, renderLocal)
            appendJobLog(jobId, `Rendered final to ${renderLocal}`)
          } catch (e: any) {
            appendJobLog(jobId, `Render failed, falling back to copy: ${e?.message || String(e)}`)
            fs.copyFileSync(normalizedLocal, renderLocal)
          }

          // Upload final to canonical outputs path
          const finalPath = `outputs/${uid}/${jobId}/final.mp4`;
          const finalFile = bucket.file(finalPath);
          await finalFile.save(fs.readFileSync(renderLocal), { resumable: false, contentType: 'video/mp4' });

          // Persist only the storage path (no signed URLs)
          await updateJob(jobId, { phase: 'DONE', overallProgress: 1, overallEtaSec: 0, message: 'Complete', finalVideoPath: finalPath });
          appendJobLog(jobId, `Render uploaded: ${finalPath}`);
        } catch (e: any) {
          appendJobLog(jobId, `Analysis/render exception: ${e?.message || String(e)}`);
          await updateJob(jobId, { phase: 'ERROR', message: 'Analysis/render failed', error: e?.message || String(e) });
          return;
        }
      } catch (e: any) {
        console.error('[jobs pipeline] Unhandled error:', e);
        await updateJob(jobId, { phase: 'FAILED', message: 'Pipeline error', error: e?.message || String(e) });
      }
    })();

    return NextResponse.json({ jobId: job.id });
  } catch (err: any) {
    console.error("/api/jobs POST error:", err);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
