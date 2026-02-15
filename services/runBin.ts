import { spawn, ChildProcess } from "child_process";

export async function runBin(
  binPath: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number }
) {
  return await new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      let child: ChildProcess | null = null;
      try {
        child = spawn(binPath, args, {
          cwd: opts?.cwd,
          windowsHide: true,
          shell: false,
        });
      } catch (err: any) {
        return reject(new Error(`spawn error: ${err?.message || String(err)}`));
      }

      let stdout = "";
      let stderr = "";
      let finished = false;

      const onFinish = (code: number) => {
        if (finished) return;
        finished = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve({ code: code ?? -1, stdout, stderr });
      };

      const onError = (err: Error) => {
        if (finished) return;
        finished = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(new Error(`spawn error: ${err.message}`));
      };

      if (child.stdout) child.stdout.on("data", (d) => (stdout += d.toString()));
      if (child.stderr) child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("error", onError);
      child.on("close", onFinish);

      let timeoutHandle: NodeJS.Timeout | null = null;
      if (opts?.timeoutMs && opts.timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          try {
            if (!finished) {
              // attempt graceful kill, then force
              child?.kill();
              setTimeout(() => {
                try {
                  if (!finished) child?.kill("SIGKILL");
                } catch (_) {}
              }, 2000);
              reject(new Error(`Process timeout after ${opts.timeoutMs}ms`));
            }
          } catch (e) {
            reject(new Error(`Timeout kill failed: ${String(e)}`));
          }
        }, opts.timeoutMs);
      }
    }
  );
}
