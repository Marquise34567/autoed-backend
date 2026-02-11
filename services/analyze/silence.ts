import { resolveFfmpegPath } from "@/lib/ffmpeg/resolve";
import { runCommand } from "@/lib/server/exec";

export type SilenceInterval = { start: number; end: number };

export async function detectSilenceIntervals(
  inputPath: string
): Promise<SilenceInterval[]> {
  const ffmpeg = resolveFfmpegPath();
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
    const { stderr } = await runCommand(ffmpeg, args);
    const lines = stderr.split(/\r?\n/);
    const intervals: SilenceInterval[] = [];
    let currentStart: number | null = null;

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
  } catch {
    return [];
  }
}
