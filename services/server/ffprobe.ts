import { resolveFfmpegPath, resolveFfprobePath } from "@/lib/ffmpeg/resolve";
import { runCommand } from "@/lib/server/exec";

export type VideoMetadata = { width: number; height: number; duration: number };

export async function getVideoMetadata(
  inputPath: string
): Promise<VideoMetadata> {
  try {
    const ffprobe = resolveFfprobePath();
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

    const { stdout } = await runCommand(ffprobe, args);
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ width?: number; height?: number }>;
      format?: { duration?: string | number };
    };
    const stream = parsed.streams?.[0];
    const formatDuration = parsed.format?.duration;
    const duration = Number(formatDuration ?? 0);
    return {
      width: Number(stream?.width ?? 1920),
      height: Number(stream?.height ?? 1080),
      duration: Number.isFinite(duration) ? duration : 0,
    };
  } catch {
    try {
      const ffmpeg = resolveFfmpegPath();
      const { stderr } = await runCommand(ffmpeg, ["-i", inputPath]);
      const match = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        const seconds = Number(match[3]);
        const duration = hours * 3600 + minutes * 60 + seconds;
        return { width: 1920, height: 1080, duration };
      }
    } catch {
      // ignore
    }
    return { width: 1920, height: 1080, duration: 0 };
  }
}
