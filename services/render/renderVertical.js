"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderVerticalClip = renderVerticalClip;
exports.renderDraftClip = renderDraftClip;
exports.renderThumbnail = renderThumbnail;
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const resolve_1 = require("@/lib/ffmpeg/resolve");
const exec_1 = require("@/lib/server/exec");
const ffprobe_1 = require("@/lib/server/ffprobe");
function buildFacecamCrop(meta, manual) {
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
function buildAudioFilter(soundEnhance) {
    if (!soundEnhance)
        return null;
    return "loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=60,alimiter,afftdn=nf=-20";
}
async function renderClip(options) {
    const ffmpeg = (0, resolve_1.resolveFfmpegPath)();
    const meta = await (0, ffprobe_1.getVideoMetadata)(options.inputPath);
    await fs_1.promises.mkdir(path_1.default.dirname(options.outputPath), { recursive: true });
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
    args.push("-c:v", "libx264", "-preset", options.preset ?? "fast", "-crf", String(options.crf ?? 20));
    args.push("-c:a", "aac", "-b:a", "160k");
    args.push(options.outputPath);
    await (0, exec_1.runCommand)(ffmpeg, args);
}
async function renderVerticalClip(options) {
    await renderClip(options);
}
async function renderDraftClip(options) {
    await renderClip({
        ...options,
        size: options.size ?? "1280x720",
        preset: options.preset ?? "ultrafast",
        crf: options.crf ?? 28,
    });
}
async function renderThumbnail(inputPath, outputPath, timestamp) {
    const ffmpeg = (0, resolve_1.resolveFfmpegPath)();
    await fs_1.promises.mkdir(path_1.default.dirname(outputPath), { recursive: true });
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
    await (0, exec_1.runCommand)(ffmpeg, args);
}
