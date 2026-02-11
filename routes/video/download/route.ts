import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/authServer";
import { getJob } from "@/lib/jobs";
import { getBucket } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_MS = 10 * 60 * 1000; // 10 minutes

const URL_MARKERS = [
  "http://",
  "https://",
  "storage.googleapis.com",
  "GoogleAccessId=",
  "X-Goog-Algorithm",
  "X-Goog-Credential",
  "X-Goog-Signature",
];

function looksLikeUrl(value: string) {
  const v = value.trim();
  if (!v) return false;
  if (v.includes("?")) return true;
  return URL_MARKERS.some((m) => v.includes(m));
}

function normalizeStoragePath(raw: string | undefined | null) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("gs://")) {
    return trimmed.replace(/^gs:\/\/[^/]+\//, "");
  }
  return trimmed;
}

function extractUidFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  if (parts[0] === "outputs" && parts[1] === "uploads" && parts.length >= 3) {
    return parts[2] || null;
  }
  if (parts[0] === "outputs" && parts.length >= 2) {
    return parts[1] || null;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const { uid } = await requireAuth(request);

    let body: any = null;
    try {
      body = await request.json();
    } catch (_) {
      body = null;
    }

    const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const finalVideoPath =
      normalizeStoragePath(job.finalVideoPath) ||
      normalizeStoragePath((job as any).objectPathOutput);

    if (!finalVideoPath) {
      return NextResponse.json({ error: "Video not ready" }, { status: 409 });
    }

    if (looksLikeUrl(finalVideoPath)) {
      return NextResponse.json({ error: "Invalid storage path" }, { status: 400 });
    }

    const ownerFromPath = extractUidFromPath(finalVideoPath);
    if (job.uid && job.uid !== uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!job.uid && ownerFromPath && ownerFromPath !== uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!job.uid && !ownerFromPath) {
      return NextResponse.json({ error: "Unable to verify ownership" }, { status: 403 });
    }

    const bucket = getBucket();
    const file = bucket.file(finalVideoPath);
    const [exists] = await file.exists();
    if (!exists) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_MS);
    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: expiresAt,
    });

    const response = NextResponse.json(
      { url: signedUrl, expiresAt: expiresAt.toISOString() },
      { status: 200 }
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (err: any) {
    if (err instanceof Response) return err;
    return NextResponse.json(
      { error: "Failed to generate download URL", details: err?.message || String(err) },
      { status: 500 }
    );
  }
}
