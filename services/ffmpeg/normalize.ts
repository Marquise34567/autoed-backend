import path from "path";
import fs from "fs";
import { runBin } from "@/lib/runBin";
import { resolveFfmpegPath, resolveFfprobePath } from "@/lib/ffmpeg/resolve";
import { setJob, appendJobLog } from "@/lib/jobs";

export async function normalizeToMp4(inputPath: string, outputPath: string, jobId?: string) {
  const ffmpeg = resolveFfmpegPath();
  const ffprobe = resolveFfprobePath();

  // Ensure output dir
  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });

  // Small helper to update job progress if jobId provided
  const progress = (p: number, etaSec?: number, msg?: string) => {
    if (!jobId) return;
    try {
      setJob(jobId, { status: "NORMALIZING", overallProgress: Math.max(0, Math.min(1, p)), overallEtaSec: etaSec ?? 0, message: msg ?? "Normalizing video" });
      appendJobLog(jobId, `NORMALIZING progress ${Math.round(p * 100)}% ${msg ?? ''}`);
    } catch (e) {
      // ignore
    }
  };

  progress(0.05, 0, "Starting preflight probe");

  // Run ffprobe to inspect streams
  try {
    const probeArgs = ["-v", "error", "-print_format", "json", "-show_streams", inputPath];
    const probeRes = await runBin(ffprobe, probeArgs);
    if (probeRes.code !== 0) {
      // Can't probe, fall back to transcode
      progress(0.12, 60, "ffprobe failed, will transcode");
    } else {
      progress(0.12, 40, "Probed input");
    }
  } catch (e) {
    progress(0.12, 60, "Probe error");
  }

  // First attempt: remux (fast copy) into MP4 container
  progress(0.15, 60, "Attempting remux (fast)");
  try {
    const remuxArgs = ["-y", "-i", inputPath, "-c", "copy", "-map", "0", "-movflags", "+faststart", outputPath];
    const remux = await runBin(ffmpeg, remuxArgs);
    if (remux.code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      progress(0.9, 10, "Remux complete");
      appendJobLog(jobId || "", `Remux succeeded for ${path.basename(inputPath)}`);
      return { success: true, method: "remux", stdout: remux.stdout, stderr: remux.stderr };
    }

    // If remux failed, log and continue to transcode
    appendJobLog(jobId || "", `Remux failed, falling back to transcode. ffmpeg code=${remux.code}`);
    console.warn("Remux failed, falling back to transcode:", remux.stderr.slice(0, 2000));
  } catch (e: any) {
    appendJobLog(jobId || "", `Remux thrown error: ${e?.message || String(e)}`);
  }

  // Fallback: transcode to H.264 + AAC
  progress(0.2, 120, "Transcoding to MP4 (this may take a while)");
  try {
    const transArgs = [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath,
    ];

    // Run ffmpeg and stream progress via stderr (best-effort parsing)
    const trans = await runBin(ffmpeg, transArgs);
    if (trans.code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      progress(0.95, 5, "Transcode complete");
      appendJobLog(jobId || "", `Transcode succeeded for ${path.basename(inputPath)}`);
      return { success: true, method: "transcode", stdout: trans.stdout, stderr: trans.stderr };
    }

    appendJobLog(jobId || "", `Transcode failed, ffmpeg code=${trans.code}`);
    return { success: false, method: "transcode", stdout: trans.stdout, stderr: trans.stderr, code: trans.code };
  } catch (e: any) {
    appendJobLog(jobId || "", `Transcode exception: ${e?.message || String(e)}`);
    return { success: false, error: e?.message || String(e) };
  }
}

export default normalizeToMp4;
