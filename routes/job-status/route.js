"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.GET = GET;
const server_1 = require("next/server");
const fsSync = __importStar(require("fs"));
const jobStore_1 = require("@/lib/server/jobStore");
exports.runtime = "nodejs";
async function GET(request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
        return server_1.NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const job = (0, jobStore_1.getJob)(id);
    if (!job) {
        return server_1.NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    // Calculate file sizes if files exist
    let inputSizeBytes;
    let outputSizeBytes;
    if (job.filePath) {
        try {
            const stats = fsSync.statSync(job.filePath);
            inputSizeBytes = stats.size;
        }
        catch {
            // file may not exist yet
        }
    }
    if (job.outputPath) {
        try {
            const stats = fsSync.statSync(job.outputPath);
            outputSizeBytes = stats.size;
        }
        catch {
            // output file may not exist yet
        }
    }
    return server_1.NextResponse.json({
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
