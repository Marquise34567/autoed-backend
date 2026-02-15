import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

let cachedFfmpeg: string | null = null;
let cachedFfprobe: string | null = null;

function findInPath(binaryName: string): string | null {
  try {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "where" : "which";
    const result = execSync(`${command} ${binaryName}`, { 
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const lines = result.split("\n").filter(Boolean);
    if (lines.length > 0) {
      const binPath = lines[0].trim();
      if (fs.existsSync(binPath)) {
        return binPath;
      }
    }
  } catch {
    // Command failed, binary not in PATH
  }
  return null;
}

export function resolveFfmpegPath(): string {
  if (cachedFfmpeg) return cachedFfmpeg;

  // 1. Check environment variable
  const envPath = process.env.FFMPEG_PATH;
  if (envPath && fs.existsSync(envPath)) {
    cachedFfmpeg = envPath;
    console.log("[ffmpeg] Using FFMPEG_PATH:", cachedFfmpeg);
    return cachedFfmpeg;
  }

  // 2. Try ffmpeg-static
  if (ffmpegStatic) {
    const staticPath = ffmpegStatic as string;
    if (fs.existsSync(staticPath)) {
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
  throw new Error(
    "FFmpeg not found. Install ffmpeg-static or add FFmpeg to PATH. " +
    "On Windows: winget install Gyan.FFmpeg"
  );
}

export function resolveFfprobePath(): string {
  if (cachedFfprobe) return cachedFfprobe;

  // 1. Check environment variable
  const envPath = process.env.FFPROBE_PATH;
  if (envPath && fs.existsSync(envPath)) {
    cachedFfprobe = envPath;
    console.log("[ffprobe] Using FFPROBE_PATH:", cachedFfprobe);
    return cachedFfprobe;
  }

  // 2. Try ffprobe-static
  if (ffprobeStatic?.path) {
    const staticPath = ffprobeStatic.path as string;
    if (fs.existsSync(staticPath)) {
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
  throw new Error(
    "FFprobe not found. Install ffprobe-static or add FFprobe to PATH. " +
    "On Windows: winget install Gyan.FFmpeg"
  );
}

export function normalizePath(inputPath: string) {
  return path.normalize(inputPath);
}

// Preflight check - call this at startup or API entry
export function checkBinaries(): { ffmpeg: string; ffprobe: string } {
  const ffmpeg = resolveFfmpegPath();
  const ffprobe = resolveFfprobePath();
  return { ffmpeg, ffprobe };
}
