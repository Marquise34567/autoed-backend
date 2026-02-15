import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createJob, updateJob, appendJobLog } from "@/lib/jobs";
import { processVideo } from '@/services/jobsProcessor'
import path from "path";
import fs from "fs";
import { getBucket } from "@/lib/firebaseAdmin";
import normalizeToMp4 from "@/lib/ffmpeg/normalize";
import { probeDurationSec, detectSilenceSegments, selectBoringCuts, analyzeVideo } from '@/lib/videoAnalysis';
import { renderEditedVideo } from '@/lib/ffmpeg/renderEdited';

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
    }

    const body = await request.json();
    const storagePath = typeof body?.storagePath === "string" ? body.storagePath : (typeof body?.path === 'string' ? body.path : null);
    if (!storagePath) {
      return NextResponse.json({ error: "Missing storagePath" }, { status: 400 });
    }
    const downloadURL = typeof body?.downloadURL === 'string' ? body.downloadURL : null;
    // Construct gsUri internally using configured bucket
    const gsUri = process.env.FIREBASE_STORAGE_BUCKET ? `gs://${process.env.FIREBASE_STORAGE_BUCKET}/${storagePath}` : null;

    const jobId = randomUUID();
    // try to infer uid from storagePath (expect uploads/{uid}/... or {uid}/...)
    const parts = storagePath.split('/').filter(Boolean);
    const inferredUid = parts.length ? (parts[0] === 'uploads' && parts[1] ? parts[1] : parts[0]) : 'unknown';

    const job = await createJob({
      id: jobId,
      uid: inferredUid,
      phase: 'UPLOADING',
      overallProgress: 0,
      overallEtaSec: null,
      message: 'Upload complete',
      createdAt: Date.now(),
      // Persist canonical storage info
      storagePath: storagePath,
      gsUri: gsUri,
      downloadURL: downloadURL || null,
      objectPathOriginal: storagePath,
      logs: [`Created job for ${storagePath}`],
    } as any);

    // Start async pipeline in background; return jobId immediately so client can poll
    try {
      processVideo(jobId, { storagePath, gsUri, downloadURL }).catch((e) => {
        console.error(`[jobs:${jobId}] processVideo uncaught error:`, e)
        appendJobLog(jobId, `processVideo uncaught error: ${e?.message || String(e)}`)
      })
    } catch (e) {
      console.error(`[jobs:${jobId}] Failed to start processVideo:`, e)
      appendJobLog(jobId, `Failed to start processVideo: ${e?.message || String(e)}`)
    }

    return NextResponse.json({ jobId: job.id })
  } catch (err: any) {
    console.error("/api/jobs POST error:", err);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
