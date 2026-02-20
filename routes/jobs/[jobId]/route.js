"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = exports.runtime = void 0;
exports.GET = GET;
const server_1 = require("next/server");
const jobs_1 = require("../../../../services/jobs");
exports.runtime = "nodejs";
exports.dynamic = "force-dynamic";
async function GET(_req, { params }) {
    // In Next.js App Router params may be a Promise; await to be safe
    const resolvedParams = (params && typeof params.then === 'function') ? await params : params;
    const jobId = resolvedParams?.jobId;
    if (!jobId) {
        return server_1.NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }
    const job = await (0, jobs_1.getJob)(jobId);
    if (!job) {
        return server_1.NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
    }
    // Normalize output to client-friendly shape
    const normalized = {
        ok: true,
        status: job.status || job.phase || 'unknown',
        step: job.step || job.stage || job.phase || 'unknown',
        progress: typeof job.progress === 'number' ? job.progress : (job.overallProgress ?? null),
        eta: job.etaSec ?? job.overallEtaSec ?? null,
        errorMessage: job.error || null,
        createdAt: job.createdAt || null,
        updatedAt: job.updatedAt || null,
        resultUrls: job.resultUrls || job.resultUrl ? job.resultUrls || { final: job.resultUrl } : job.videoUrl ? { final: job.videoUrl } : job.finalVideoPath ? { final: job.finalVideoPath } : null,
        logs: job.logs || [],
    };
    return server_1.NextResponse.json(normalized, { status: 200 });
}
