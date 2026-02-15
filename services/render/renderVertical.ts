import path from "path";
import { promises as fs } from "fs";
import { resolveFfmpegPath } from "@/lib/ffmpeg/resolve";
import { runCommand } from "@/lib/server/exec";
import { getVideoMetadata } from "@/lib/server/ffprobe";
import type { VideoMetadata } from "@/lib/server/ffprobe";
import { ManualFacecamCrop } from "@/lib/types";

export type RenderOptions = {
  inputPath: string;
  outputPath: string;
  start: number;
  end: number;
  soundEnhance: boolean;
  manualFacecamCrop?: ManualFacecamCrop | null;
  size?: "1920x1080" | "1280x720" | "854x480";
  preset?: "ultrafast" | "veryfast" | "fast" | "medium";
  crf?: number;
};

function buildFacecamCrop(
  meta: VideoMetadata,
  manual?: ManualFacecamCrop | null
) {
  if (manual) {
    const cropW = Math.round(meta.width * manual.w);
    const cropH = Math.round(meta.height * manual.h);
    const cropX = Math.round(meta.width * manual.x);
    const cropY = Math.round(meta.height * manual.y);
    return `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=960:1080:force_original_aspect_ratio=increase,crop=960:1080`;
  }
  return "scale=960:1080:force_original_aspect_ratio=increase,crop=960:1080";
}

function buildContentCrop() {
  return "scale=960:1080:force_original_aspect_ratio=increase,crop=960:1080";
}

function buildAudioFilter(soundEnhance: boolean) {
  if (!soundEnhance) return null;
  return "loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=60,alimiter,afftdn=nf=-20";
}

async function renderClip(options: RenderOptions) {
  const ffmpeg = resolveFfmpegPath();
  const meta = await getVideoMetadata(options.inputPath);
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });

  const facecamFilter = buildFacecamCrop(meta, options.manualFacecamCrop);
  const contentFilter = buildContentCrop();
  const duration = Math.max(0.2, options.end - options.start);

  const filterComplex = [
    `[0:v]trim=start=${options.start}:end=${options.end},setpts=PTS-STARTPTS,split=2[v1][v2]`,
    `[v1]${facecamFilter}[face]`,
    `[v2]${contentFilter}[content]`,
    `[face][content]hstack=inputs=2[vout]`,
  ].join(";");

  const args = [
    "-y",
    "-i",
    options.inputPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-s",
    options.size ?? "1920x1080",
    "-t",
    duration.toFixed(2),
  ];

  const audioFilter = buildAudioFilter(options.soundEnhance);
  if (audioFilter) {
    args.push("-af", audioFilter);
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    options.preset ?? "fast",
    "-crf",
    String(options.crf ?? 20)
  );
  args.push("-c:a", "aac", "-b:a", "160k");
  args.push(options.outputPath);

  await runCommand(ffmpeg, args);
}

export async function renderVerticalClip(options: RenderOptions) {
  await renderClip(options);
}

export async function renderDraftClip(options: RenderOptions) {
  await renderClip({
    ...options,
    size: options.size ?? "1280x720",
    preset: options.preset ?? "ultrafast",
    crf: options.crf ?? 28,
  });
}

export async function renderThumbnail(
  inputPath: string,
  outputPath: string,
  timestamp: number
) {
  const ffmpeg = resolveFfmpegPath();
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const args = [
    "-y",
    "-ss",
    timestamp.toFixed(2),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=640:360:force_original_aspect_ratio=increase,crop=640:360",
    outputPath,
  ];
  await runCommand(ffmpeg, args);
}
