"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcribeWithWhisper = transcribeWithWhisper;
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const exec_1 = require("@/lib/server/exec");
async function transcribeWithWhisper(inputPath, outputDir) {
    const enabled = process.env.WHISPER_ENABLED === "true";
    const whisperCmd = process.env.WHISPER_CLI || "whisper";
    if (!enabled)
        return [];
    await fs_1.promises.mkdir(outputDir, { recursive: true });
    const baseName = path_1.default.basename(inputPath, path_1.default.extname(inputPath));
    const args = [
        inputPath,
        "--model",
        process.env.WHISPER_MODEL || "tiny",
        "--output_format",
        "json",
        "--output_dir",
        outputDir,
    ];
    try {
        await (0, exec_1.runCommand)(whisperCmd, args, { cwd: outputDir });
    }
    catch {
        return [];
    }
    const jsonPath = path_1.default.join(outputDir, `${baseName}.json`);
    try {
        const raw = await fs_1.promises.readFile(jsonPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed.segments)
            return [];
        return parsed.segments.map((segment) => ({
            start: segment.start,
            end: segment.end,
            text: segment.text?.trim() ?? "",
        }));
    }
    catch {
        return [];
    }
}
