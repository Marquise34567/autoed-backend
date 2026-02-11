import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { getJob } from "@/lib/server/jobStore";

export const runtime = "nodejs";

function getMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  return "application/octet-stream";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  const kind = searchParams.get("kind") || "final";

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found", details: jobId }, { status: 404 });
  }

  let outputPath = job.outputPath || "";
  if (!outputPath) {
    const fileName = kind === "draft" ? "draft.mp4" : "final.mp4";
    outputPath = path.join(process.cwd(), "public", "outputs", jobId, fileName);
  }

  if (!fs.existsSync(outputPath)) {
    return NextResponse.json(
      { error: "Output file missing", details: outputPath },
      { status: 404 }
    );
  }

  const stat = fs.statSync(outputPath);
  const fileSize = stat.size;
  const range = request.headers.get("range");
  const contentType = getMimeType(outputPath);

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return NextResponse.json(
        { error: "Invalid Range header", details: range },
        { status: 416 }
      );
    }

    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= fileSize) end = fileSize - 1;

    if (start > end || start >= fileSize) {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${fileSize}`,
          "Accept-Ranges": "bytes",
        },
      });
    }

    const chunkSize = end - start + 1;
    const fileStream = fs.createReadStream(outputPath, { start, end });
    const webStream = Readable.toWeb(fileStream) as ReadableStream;

    return new Response(webStream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize.toString(),
      },
    });
  }

  const stream = fs.createReadStream(outputPath);
  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Length": fileSize.toString(),
    },
  });
}
