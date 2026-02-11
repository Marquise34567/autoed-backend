import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

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
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(job, { status: 200 });
}
