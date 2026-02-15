import { NextResponse } from "next/server";
import { getJob } from "../../../../services/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { jobId: string } }
) {
  // In Next.js App Router params may be a Promise; await to be safe
  const resolvedParams = (params && typeof (params as any).then === 'function') ? await (params as any) : params
  const jobId = resolvedParams?.jobId;

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const job = await getJob(jobId);

  if (!job) {
    return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  // Normalize output to client-friendly shape
  const normalized = {
    ok: true,
    status: (job as any).status || (job as any).phase || 'unknown',
    step: (job as any).step || (job as any).stage || (job as any).phase || 'unknown',
    progress: typeof (job as any).progress === 'number' ? (job as any).progress : ((job as any).overallProgress ?? null),
    eta: (job as any).etaSec ?? (job as any).overallEtaSec ?? null,
    errorMessage: (job as any).error || null,
    createdAt: (job as any).createdAt || null,
    updatedAt: (job as any).updatedAt || null,
    resultUrls: (job as any).resultUrls || (job as any).resultUrl ? (job as any).resultUrls || { final: (job as any).resultUrl } : (job as any).videoUrl ? { final: (job as any).videoUrl } : (job as any).finalVideoPath ? { final: (job as any).finalVideoPath } : null,
    logs: (job as any).logs || [],
  };

  return NextResponse.json(normalized, { status: 200 });
}
