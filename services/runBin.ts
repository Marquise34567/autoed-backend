import { spawn } from "child_process";

export async function runBin(
  binPath: string,
  args: string[],
  opts?: { cwd?: string }
) {
  return await new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(binPath, args, {
        cwd: opts?.cwd,
        windowsHide: true,
        shell: false,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("error", (err) => {
        reject(new Error(`spawn error: ${err.message}`));
      });

      child.on("close", (code) => {
        resolve({ code: code ?? -1, stdout, stderr });
      });
    }
  );
}
