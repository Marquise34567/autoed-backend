"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFfmpegPath = resolveFfmpegPath;
exports.resolveFfprobePath = resolveFfprobePath;
exports.normalizePath = normalizePath;
exports.checkBinaries = checkBinaries;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const ffprobe_static_1 = __importDefault(require("ffprobe-static"));
let cachedFfmpeg = null;
let cachedFfprobe = null;
function findInPath(binaryName) {
    try {
        const isWindows = process.platform === "win32";
        const command = isWindows ? "where" : "which";
        const result = (0, child_process_1.execSync)(`${command} ${binaryName}`, {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"]
        });
        const lines = result.split("\n").filter(Boolean);
        if (lines.length > 0) {
            const binPath = lines[0].trim();
            if (fs_1.default.existsSync(binPath)) {
                return binPath;
            }
        }
    }
    catch {
        // Command failed, binary not in PATH
    }
    return null;
}
function resolveFfmpegPath() {
    if (cachedFfmpeg)
        return cachedFfmpeg;
    // 1. Check environment variable
    const envPath = process.env.FFMPEG_PATH;
    if (envPath && fs_1.default.existsSync(envPath)) {
        cachedFfmpeg = envPath;
        console.log("[ffmpeg] Using FFMPEG_PATH:", cachedFfmpeg);
        return cachedFfmpeg;
    }
    // 2. Try ffmpeg-static
    if (ffmpeg_static_1.default) {
        const staticPath = ffmpeg_static_1.default;
        if (fs_1.default.existsSync(staticPath)) {
            cachedFfmpeg = staticPath;
            console.log("[ffmpeg] Using ffmpeg-static:", cachedFfmpeg);
            return cachedFfmpeg;
        }
    }
    // 3. Search in PATH
    const pathBin = findInPath("ffmpeg");
    if (pathBin) {
        cachedFfmpeg = pathBin;
        console.log("[ffmpeg] Using PATH binary:", cachedFfmpeg);
        return cachedFfmpeg;
    }
    // 4. Last resort - return "ffmpeg" and let spawn fail with clear error
    throw new Error("FFmpeg not found. Install ffmpeg-static or add FFmpeg to PATH. " +
        "On Windows: winget install Gyan.FFmpeg");
}
function resolveFfprobePath() {
    if (cachedFfprobe)
        return cachedFfprobe;
    // 1. Check environment variable
    const envPath = process.env.FFPROBE_PATH;
    if (envPath && fs_1.default.existsSync(envPath)) {
        cachedFfprobe = envPath;
        console.log("[ffprobe] Using FFPROBE_PATH:", cachedFfprobe);
        return cachedFfprobe;
    }
    // 2. Try ffprobe-static
    if (ffprobe_static_1.default?.path) {
        const staticPath = ffprobe_static_1.default.path;
        if (fs_1.default.existsSync(staticPath)) {
            cachedFfprobe = staticPath;
            console.log("[ffprobe] Using ffprobe-static:", cachedFfprobe);
            return cachedFfprobe;
        }
    }
    // 3. Search in PATH
    const pathBin = findInPath("ffprobe");
    if (pathBin) {
        cachedFfprobe = pathBin;
        console.log("[ffprobe] Using PATH binary:", cachedFfprobe);
        return cachedFfprobe;
    }
    // 4. Last resort - throw error
    throw new Error("FFprobe not found. Install ffprobe-static or add FFprobe to PATH. " +
        "On Windows: winget install Gyan.FFmpeg");
}
function normalizePath(inputPath) {
    return path_1.default.normalize(inputPath);
}
// Preflight check - call this at startup or API entry
function checkBinaries() {
    const ffmpeg = resolveFfmpegPath();
    const ffprobe = resolveFfprobePath();
    return { ffmpeg, ffprobe };
}
