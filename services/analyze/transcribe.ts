import path from "path";
import { promises as fs } from "fs";
import { runCommand } from "@/lib/server/exec";
import { TranscriptSegment } from "@/lib/types";

type WhisperSegment = {
  start: number;
  end: number;
  text: string;
};

type WhisperJson = {
  segments?: WhisperSegment[];
};

export async function transcribeWithWhisper(
  inputPath: string,
  outputDir: string
): Promise<TranscriptSegment[]> {
  const enabled = process.env.WHISPER_ENABLED === "true";
  const whisperCmd = process.env.WHISPER_CLI || "whisper";
  if (!enabled) return [];

  await fs.mkdir(outputDir, { recursive: true });
  const baseName = path.basename(inputPath, path.extname(inputPath));

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
    await runCommand(whisperCmd, args, { cwd: outputDir });
  } catch {
    return [];
  }

  const jsonPath = path.join(outputDir, `${baseName}.json`);
  try {
    const raw = await fs.readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(raw) as WhisperJson;
    if (!parsed.segments) return [];
    return parsed.segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text?.trim() ?? "",
    }));
  } catch {
    return [];
  }
}
