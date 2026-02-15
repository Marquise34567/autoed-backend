import { NextResponse } from "next/server";
import * as fsSync from "fs";
import { getJob } from "@/lib/server/jobStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Calculate file sizes if files exist
  let inputSizeBytes: number | undefined;
  let outputSizeBytes: number | undefined;

  if (job.filePath) {
    try {
      const stats = fsSync.statSync(job.filePath);
      inputSizeBytes = stats.size;
    } catch {
      // file may not exist yet
    }
  }

  if (job.outputPath) {
    try {
      const stats = fsSync.statSync(job.outputPath);
      outputSizeBytes = stats.size;
    } catch {
      // output file may not exist yet
    }
  }

  return NextResponse.json({
    status: job.status,
    stage: job.stage,
    message: job.message,
    percent: job.percent,
    progress: job.progress ?? job.percent,
    etaSec: job.etaSec,
    draftUrl: job.draftUrl,
    finalUrl: job.finalUrl,
    outputUrl: job.outputUrl,
    inputSizeBytes,
    outputSizeBytes,
    details: job.details,
    error: job.error,
    logs: job.logs,
  });
}
