import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createJob, updateJob, appendJobLog } from "@/lib/jobs";

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

    // Log request start
    console.log('[jobs.POST] incoming', { jobId, storagePath })

    // Enqueue job for worker processing (do not process inline)
    try {
      // dynamic import to interop with JS-based queue module
      const qmod = await import('../../../../services/worker/queue')
      const enqueue = qmod.enqueue || (qmod.default && qmod.default.enqueue)
      if (typeof enqueue === 'function') {
        enqueue(jobId, { storagePath, gsUri, downloadURL })
      } else {
        console.warn('[jobs.POST] enqueue not available; job persisted and worker should pick it up')
      }
    } catch (e) {
      console.error('[jobs.POST] failed to enqueue', e)
      appendJobLog(jobId, `Failed to enqueue: ${e?.message || String(e)}`)
      // still return success because job is persisted
    }

    // Log just before responding to confirm non-blocking
    console.log('[jobs.POST] responding', { jobId })

    return NextResponse.json({ jobId: job.id })
  } catch (err: any) {
    console.error('API ERROR:', err);
    console.error('STACK:', err?.stack);
    return NextResponse.json({ ok: false, message: err?.message || 'Unknown error', stack: err?.stack || null }, { status: 500 });
  }
}
