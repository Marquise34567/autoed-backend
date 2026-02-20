"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVideoMetadata = getVideoMetadata;
const resolve_1 = require("@/lib/ffmpeg/resolve");
const exec_1 = require("@/lib/server/exec");
async function getVideoMetadata(inputPath) {
    try {
        const ffprobe = (0, resolve_1.resolveFfprobePath)();
        const args = [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            inputPath,
        ];
        const { stdout } = await (0, exec_1.runCommand)(ffprobe, args);
        const parsed = JSON.parse(stdout);
        const stream = parsed.streams?.[0];
        const formatDuration = parsed.format?.duration;
        const duration = Number(formatDuration ?? 0);
        return {
            width: Number(stream?.width ?? 1920),
            height: Number(stream?.height ?? 1080),
            duration: Number.isFinite(duration) ? duration : 0,
        };
    }
    catch {
        try {
            const ffmpeg = (0, resolve_1.resolveFfmpegPath)();
            const { stderr } = await (0, exec_1.runCommand)(ffmpeg, ["-i", inputPath]);
            const match = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
            if (match) {
                const hours = Number(match[1]);
                const minutes = Number(match[2]);
                const seconds = Number(match[3]);
                const duration = hours * 3600 + minutes * 60 + seconds;
                return { width: 1920, height: 1080, duration };
            }
        }
        catch {
            // ignore
        }
        return { width: 1920, height: 1080, duration: 0 };
    }
}
