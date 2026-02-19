"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processVideo = processVideo;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const firebaseAdmin_1 = require("@/lib/firebaseAdmin");
const normalize_1 = __importDefault(require("@/lib/ffmpeg/normalize"));
const videoAnalysis_1 = require("@/lib/videoAnalysis");
const renderEdited_1 = require("@/lib/ffmpeg/renderEdited");
const jobs_1 = require("./jobs");
async function processVideo(jobId, input) {
    console.log(`[jobsProcessor:${jobId}] Processing started`);
    try {
        await (0, jobs_1.updateJob)(jobId, { status: 'processing', progress: 0, phase: 'NORMALIZING', message: 'Processing started' });
        (0, jobs_1.appendJobLog)(jobId, 'Processing started');
        // Ensure bucket available
        let bucket;
        try {
            bucket = (0, firebaseAdmin_1.getBucket)();
        }
        catch (e) {
            console.error(`[jobsProcessor:${jobId}] Storage bucket not configured`, e);
            await (0, jobs_1.updateJob)(jobId, { status: 'failed', progress: 0, phase: 'ERROR', message: 'Storage not configured', errorMessage: 'FIREBASE_STORAGE_BUCKET missing' });
            (0, jobs_1.appendJobLog)(jobId, 'Storage bucket missing; aborting');
            return;
        }
        // Determine input source. Prefer downloadURL, then gsUri/storagePath.
        let downloadURL = null;
        let gsPath = null;
        if (typeof input === 'string') {
            gsPath = input;
        }
        else {
            downloadURL = input.downloadURL || input.downloadUrl || null;
            gsPath = input.storagePath || input.gsUri || null;
        }
        const uploadDir = path_1.default.resolve(process.cwd(), 'tmp', 'uploads');
        fs_1.default.mkdirSync(uploadDir, { recursive: true });
        const tmpBaseName = (gsPath ? path_1.default.basename(gsPath) : `download-${jobId}.bin`).replace(/[^a-z0-9.\-_]/gi, '_');
        const tmpInput = path_1.default.resolve(uploadDir, `${jobId}-${tmpBaseName}`);
        if (downloadURL) {
            console.log(`[jobsProcessor:${jobId}] Input source: downloadURL (${downloadURL})`);
            (0, jobs_1.appendJobLog)(jobId, `Downloading from downloadURL to ${tmpInput}`);
            await new Promise((resolve, reject) => {
                try {
                    const u = new URL(downloadURL);
                    const lib = u.protocol === 'https:' ? https_1.default : http_1.default;
                    const req = lib.get(u, (res) => {
                        if (!res.statusCode || res.statusCode >= 400)
                            return reject(new Error(`Failed to fetch ${downloadURL}: status ${res.statusCode}`));
                        const fileStream = fs_1.default.createWriteStream(tmpInput);
                        res.pipe(fileStream);
                        fileStream.on('finish', () => resolve());
                        fileStream.on('error', (err) => reject(err));
                    });
                    req.on('error', reject);
                }
                catch (err) {
                    return reject(err);
                }
            });
            await (0, jobs_1.updateJob)(jobId, { progress: 10, message: 'Downloaded input (from URL)' });
        }
        else if (gsPath) {
            console.log(`[jobsProcessor:${jobId}] Input source: gsUri`);
            (0, jobs_1.appendJobLog)(jobId, `Downloading ${gsPath} to ${tmpInput}`);
            // Support gs://bucket/path or plain storage-relative path
            let filePath = gsPath;
            if (gsPath.startsWith('gs://')) {
                const without = gsPath.replace(/^gs:\/\//i, '');
                const idx = without.indexOf('/');
                if (idx > 0) {
                    const bucketName = without.slice(0, idx);
                    filePath = without.slice(idx + 1);
                    const otherBucket = (0, firebaseAdmin_1.getBucket)(bucketName);
                    const remoteFile = otherBucket.file(filePath);
                    const [exists] = await remoteFile.exists();
                    if (!exists) {
                        console.error(`[jobsProcessor:${jobId}] Source file not found: ${gsPath}`);
                        await (0, jobs_1.updateJob)(jobId, { status: 'failed', progress: 0, phase: 'ERROR', message: 'Source file not found', errorMessage: 'Source file missing' });
                        (0, jobs_1.appendJobLog)(jobId, `Source file not found: ${gsPath}`);
                        return;
                    }
                    await remoteFile.download({ destination: tmpInput });
                    await (0, jobs_1.updateJob)(jobId, { progress: 10, message: 'Downloaded input' });
                }
                else {
                    console.error(`[jobsProcessor:${jobId}] Invalid gs:// URI: ${gsPath}`);
                    await (0, jobs_1.updateJob)(jobId, { status: 'failed', progress: 0, phase: 'ERROR', message: 'Invalid gsUri', errorMessage: 'Invalid gsUri' });
                    (0, jobs_1.appendJobLog)(jobId, `Invalid gsUri: ${gsPath}`);
                    return;
                }
            }
            else {
                const remoteFile = bucket.file(filePath);
                const [exists] = await remoteFile.exists();
                if (!exists) {
                    console.error(`[jobsProcessor:${jobId}] Source file not found: ${filePath}`);
                    await (0, jobs_1.updateJob)(jobId, { status: 'failed', progress: 0, phase: 'ERROR', message: 'Source file not found', errorMessage: 'Source file missing' });
                    (0, jobs_1.appendJobLog)(jobId, `Source file not found: ${filePath}`);
                    return;
                }
                const safeName = path_1.default.basename(filePath).replace(/[^a-z0-9.\-_]/gi, '_');
                await remoteFile.download({ destination: tmpInput });
                await (0, jobs_1.updateJob)(jobId, { progress: 10, message: 'Downloaded input' });
            }
        }
        else {
            console.error(`[jobsProcessor:${jobId}] No input source provided`);
            await (0, jobs_1.updateJob)(jobId, { status: 'failed', progress: 0, phase: 'ERROR', message: 'No input source', errorMessage: 'Missing input' });
            (0, jobs_1.appendJobLog)(jobId, 'No input source specified; aborting');
            return;
        }
        console.log(`[jobsProcessor:${jobId}] Running ffmpeg (normalize)`);
        await (0, jobs_1.updateJob)(jobId, { progress: 20, message: 'Normalizing input' });
        const normalizedLocal = path_1.default.resolve(uploadDir, `${jobId}-normalized.mp4`);
        const normRes = await (0, normalize_1.default)(tmpInput, normalizedLocal, jobId);
        if (!normRes || !normRes.success) {
            console.error(`[jobsProcessor:${jobId}] Normalization failed`, normRes);
            await (0, jobs_1.updateJob)(jobId, { status: 'failed', progress: 0, phase: 'ERROR', message: 'Normalization failed', errorMessage: normRes?.error || 'Normalization failed' });
            (0, jobs_1.appendJobLog)(jobId, `Normalization failed: ${JSON.stringify(normRes).slice(0, 200)}`);
            return;
        }
        await (0, jobs_1.updateJob)(jobId, { progress: 30, message: 'Normalized input', objectPathNormalized: null });
        // analysis
        console.log(`[jobsProcessor:${jobId}] Analyzing video`);
        (0, jobs_1.appendJobLog)(jobId, `Probing duration for ${normalizedLocal}`);
        const durationSec = await (0, videoAnalysis_1.probeDurationSec)(normalizedLocal);
        (0, jobs_1.appendJobLog)(jobId, `Duration: ${durationSec}s`);
        await (0, jobs_1.updateJob)(jobId, { progress: 40, message: 'Analyzing video', durationSec });
        const silenceSegments = await (0, videoAnalysis_1.detectSilenceSegments)(normalizedLocal);
        (0, jobs_1.appendJobLog)(jobId, `Detected ${silenceSegments.length} silence segments`);
        await (0, jobs_1.updateJob)(jobId, { progress: 50, message: 'Selecting hooks' });
        const analysis = await (0, videoAnalysis_1.analyzeVideo)(normalizedLocal);
        const hook = (analysis.hookCandidates && analysis.hookCandidates.length) ? analysis.hookCandidates[0] : { start: 0, end: Math.min(7, Math.floor(durationSec)) };
        (0, jobs_1.appendJobLog)(jobId, `Selected hook at ${hook.start}-${hook.end}`);
        await (0, jobs_1.updateJob)(jobId, { progress: 55, hook });
        console.log(`[jobsProcessor:${jobId}] Running ffmpeg (render)`);
        await (0, jobs_1.updateJob)(jobId, { progress: 65, message: 'Rendering final video' });
        const renderLocal = path_1.default.resolve(process.cwd(), 'tmp', 'renders', `${jobId}-final.mp4`);
        fs_1.default.mkdirSync(path_1.default.dirname(renderLocal), { recursive: true });
        try {
            await (0, renderEdited_1.renderEditedVideo)(normalizedLocal, { start: hook.start, end: hook.end }, [], renderLocal);
            (0, jobs_1.appendJobLog)(jobId, `Rendered final to ${renderLocal}`);
        }
        catch (e) {
            (0, jobs_1.appendJobLog)(jobId, `Render failed, copying normalized as fallback: ${e?.message || String(e)}`);
            fs_1.default.copyFileSync(normalizedLocal, renderLocal);
        }
        console.log(`[jobsProcessor:${jobId}] Uploading result`);
        await (0, jobs_1.updateJob)(jobId, { progress: 80, message: 'Uploading result' });
        const finalPath = `outputs/${jobId}/final.mp4`;
        const finalFile = bucket.file(finalPath);
        await finalFile.save(fs_1.default.readFileSync(renderLocal), { resumable: false, contentType: 'video/mp4' });
        (0, jobs_1.appendJobLog)(jobId, `Uploaded final to ${finalPath}`);
        await (0, jobs_1.updateJob)(jobId, { status: 'completed', progress: 100, phase: 'DONE', message: 'Job completed', finalVideoPath: finalPath });
        (0, jobs_1.appendJobLog)(jobId, 'Job completed');
        console.log(`[jobsProcessor:${jobId}] Job completed`);
        // cleanup
        try {
            fs_1.default.unlinkSync(renderLocal);
        }
        catch (e) { /* ignore */ }
        try {
            fs_1.default.unlinkSync(normalizedLocal);
        }
        catch (e) { /* ignore */ }
        try {
            fs_1.default.unlinkSync(tmpInput);
        }
        catch (e) { /* ignore */ }
    }
    catch (err) {
        console.error(`[jobsProcessor:${jobId}] Unhandled processing error:`, err && (err.stack || err.message || err));
        (0, jobs_1.appendJobLog)(jobId, `Processing exception: ${err?.message || String(err)}`);
        await (0, jobs_1.updateJob)(jobId, { status: 'failed', progress: 0, phase: 'ERROR', message: 'Processing failed', errorMessage: err?.message || String(err) });
    }
}
exports.default = { processVideo };
