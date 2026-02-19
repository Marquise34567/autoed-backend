"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommand = runCommand;
exports.runCommandWithProgress = runCommandWithProgress;
const child_process_1 = require("child_process");
async function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        console.log("[exec] command:", command);
        console.log("[exec] args:", JSON.stringify(args));
        const child = (0, child_process_1.spawn)(command, args, {
            cwd: options.cwd,
            env: process.env,
            windowsHide: true,
            shell: false,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data) => {
            stdout += data.toString();
        });
        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });
        child.on("error", (error) => {
            console.error("[exec] spawn error:", error.message);
            reject(error);
        });
        child.on("close", (code) => {
            if (code && code !== 0) {
                const error = new Error(`Command exited with code ${code}`);
                error.stdout = stdout;
                error.stderr = stderr;
                error.code = code;
                error.command = command;
                error.args = args;
                console.error(`[exec] exit code: ${code}`);
                console.error(`[exec] stderr (last 500 chars):\n${stderr.slice(-500)}`);
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}
async function runCommandWithProgress(command, args, options) {
    const { expectedDurationSec, onProgress, stallTimeoutSec = 10 } = options;
    return new Promise((resolve, reject) => {
        console.log("[exec] command:", command);
        console.log("[exec] args:", JSON.stringify(args));
        const child = (0, child_process_1.spawn)(command, args, {
            cwd: options.cwd,
            env: process.env,
            windowsHide: true,
            shell: false,
        });
        let stdout = "";
        let stderr = "";
        let buffer = "";
        let lastOutTimeSec = 0;
        let lastProgressAt = Date.now();
        let lastUpdate = null;
        const stallTimer = setInterval(() => {
            if (Date.now() - lastProgressAt > stallTimeoutSec * 1000) {
                clearInterval(stallTimer);
                try {
                    child.kill("SIGKILL");
                }
                catch {
                    // ignore
                }
                const error = new Error("FFmpeg stalled during final render");
                error.stdout = stdout;
                error.stderr = stderr;
                error.command = command;
                error.args = args;
                reject(error);
            }
        }, 1000);
        function parseLine(line) {
            const [key, value] = line.split("=");
            if (!key || value === undefined)
                return null;
            return { key, value };
        }
        const progressData = {};
        child.stdout.on("data", (data) => {
            const chunk = data.toString();
            stdout += chunk;
            buffer += chunk;
            let index = buffer.indexOf("\n");
            while (index !== -1) {
                const line = buffer.slice(0, index).trim();
                buffer = buffer.slice(index + 1);
                const parsed = parseLine(line);
                if (parsed) {
                    progressData[parsed.key] = parsed.value;
                }
                if (parsed?.key === "out_time_ms") {
                    const outTimeSec = Number(parsed.value) / 1000000;
                    if (Number.isFinite(outTimeSec)) {
                        lastOutTimeSec = outTimeSec;
                        lastProgressAt = Date.now();
                        const speedRaw = progressData["speed"] ?? "0";
                        const speed = Number(speedRaw.replace("x", "")) || 0;
                        const progress = expectedDurationSec > 0 ? Math.min(1, outTimeSec / expectedDurationSec) : 0;
                        const etaSec = expectedDurationSec > 0 ? Math.max(0, (expectedDurationSec - outTimeSec) / Math.max(speed, 0.1)) : 0;
                        lastUpdate = { outTimeSec, speed, progress, etaSec, raw: { ...progressData } };
                        onProgress?.(lastUpdate);
                    }
                }
                index = buffer.indexOf("\n");
            }
        });
        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });
        child.on("error", (error) => {
            clearInterval(stallTimer);
            console.error("[exec] spawn error:", error.message);
            reject(error);
        });
        child.on("close", (code) => {
            clearInterval(stallTimer);
            if (code && code !== 0) {
                const error = new Error(`Command exited with code ${code}`);
                error.stdout = stdout;
                error.stderr = stderr;
                error.code = code;
                error.command = command;
                error.args = args;
                console.error(`[exec] exit code: ${code}`);
                console.error(`[exec] stderr (last 500 chars):\n${stderr.slice(-500)}`);
                reject(error);
                return;
            }
            if (lastUpdate) {
                onProgress?.({ ...lastUpdate, progress: 1, etaSec: 0 });
            }
            resolve({ stdout, stderr });
        });
    });
}
