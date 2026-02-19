"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectSilenceIntervals = detectSilenceIntervals;
const resolve_1 = require("@/lib/ffmpeg/resolve");
const exec_1 = require("@/lib/server/exec");
async function detectSilenceIntervals(inputPath) {
    const ffmpeg = (0, resolve_1.resolveFfmpegPath)();
    const args = [
        "-i",
        inputPath,
        "-af",
        "silencedetect=n=-30dB:d=0.2",
        "-f",
        "null",
        "-",
    ];
    try {
        const { stderr } = await (0, exec_1.runCommand)(ffmpeg, args);
        const lines = stderr.split(/\r?\n/);
        const intervals = [];
        let currentStart = null;
        lines.forEach((line) => {
            const startMatch = line.match(/silence_start: ([0-9.]+)/);
            if (startMatch) {
                currentStart = Number(startMatch[1]);
            }
            const endMatch = line.match(/silence_end: ([0-9.]+)/);
            if (endMatch) {
                const end = Number(endMatch[1]);
                if (currentStart !== null) {
                    intervals.push({ start: currentStart, end });
                    currentStart = null;
                }
            }
        });
        return intervals;
    }
    catch {
        return [];
    }
}
