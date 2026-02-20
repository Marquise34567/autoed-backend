"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBin = runBin;
const child_process_1 = require("child_process");
async function runBin(binPath, args, opts) {
    return await new Promise((resolve, reject) => {
        let child = null;
        try {
            child = (0, child_process_1.spawn)(binPath, args, {
                cwd: opts?.cwd,
                windowsHide: true,
                shell: false,
            });
        }
        catch (err) {
            return reject(new Error(`spawn error: ${err?.message || String(err)}`));
        }
        let stdout = "";
        let stderr = "";
        let finished = false;
        const onFinish = (code) => {
            if (finished)
                return;
            finished = true;
            if (timeoutHandle)
                clearTimeout(timeoutHandle);
            resolve({ code: code ?? -1, stdout, stderr });
        };
        const onError = (err) => {
            if (finished)
                return;
            finished = true;
            if (timeoutHandle)
                clearTimeout(timeoutHandle);
            reject(new Error(`spawn error: ${err.message}`));
        };
        if (child.stdout)
            child.stdout.on("data", (d) => (stdout += d.toString()));
        if (child.stderr)
            child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", onError);
        child.on("close", onFinish);
        let timeoutHandle = null;
        if (opts?.timeoutMs && opts.timeoutMs > 0) {
            timeoutHandle = setTimeout(() => {
                try {
                    if (!finished) {
                        // attempt graceful kill, then force
                        child?.kill();
                        setTimeout(() => {
                            try {
                                if (!finished)
                                    child?.kill("SIGKILL");
                            }
                            catch (_) { }
                        }, 2000);
                        reject(new Error(`Process timeout after ${opts.timeoutMs}ms`));
                    }
                }
                catch (e) {
                    reject(new Error(`Timeout kill failed: ${String(e)}`));
                }
            }, opts.timeoutMs);
        }
    });
}
