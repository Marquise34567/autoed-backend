"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.GET = GET;
const server_1 = require("next/server");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const stream_1 = require("stream");
const jobStore_1 = require("@/lib/server/jobStore");
exports.runtime = "nodejs";
function getMimeType(filePath) {
    const ext = path_1.default.extname(filePath).toLowerCase();
    if (ext === ".mp4")
        return "video/mp4";
    if (ext === ".mov")
        return "video/quicktime";
    if (ext === ".webm")
        return "video/webm";
    return "application/octet-stream";
}
async function GET(request) {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    const kind = searchParams.get("kind") || "final";
    if (!jobId) {
        return server_1.NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }
    const job = (0, jobStore_1.getJob)(jobId);
    if (!job) {
        return server_1.NextResponse.json({ error: "Job not found", details: jobId }, { status: 404 });
    }
    let outputPath = job.outputPath || "";
    if (!outputPath) {
        const fileName = kind === "draft" ? "draft.mp4" : "final.mp4";
        outputPath = path_1.default.join(process.cwd(), "public", "outputs", jobId, fileName);
    }
    if (!fs_1.default.existsSync(outputPath)) {
        return server_1.NextResponse.json({ error: "Output file missing", details: outputPath }, { status: 404 });
    }
    const stat = fs_1.default.statSync(outputPath);
    const fileSize = stat.size;
    const range = request.headers.get("range");
    const contentType = getMimeType(outputPath);
    if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) {
            return server_1.NextResponse.json({ error: "Invalid Range header", details: range }, { status: 416 });
        }
        let start = match[1] ? parseInt(match[1], 10) : 0;
        let end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        if (Number.isNaN(start))
            start = 0;
        if (Number.isNaN(end) || end >= fileSize)
            end = fileSize - 1;
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
        const fileStream = fs_1.default.createReadStream(outputPath, { start, end });
        const webStream = stream_1.Readable.toWeb(fileStream);
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
    const stream = fs_1.default.createReadStream(outputPath);
    const webStream = stream_1.Readable.toWeb(stream);
    return new Response(webStream, {
        status: 200,
        headers: {
            "Content-Type": contentType,
            "Accept-Ranges": "bytes",
            "Content-Length": fileSize.toString(),
        },
    });
}
