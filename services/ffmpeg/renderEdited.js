"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderEditedVideo = renderEditedVideo;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function runProcess(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const cp = require('child_process').spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
        let stdout = '';
        let stderr = '';
        cp.stdout.on('data', (d) => { stdout += d.toString(); });
        cp.stderr.on('data', (d) => { stderr += d.toString(); });
        cp.on('error', (err) => reject(err));
        cp.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    });
}
/**
 * Render edited video by concatenating: HOOK (moved to start) + remaining timeline excluding cuts and original hook
 * hook: { start, end }
 * cuts: array of { start, end }
 */
async function renderEditedVideo(normalizedLocal, hook, cuts, outLocal) {
    // build include intervals: everything except cuts and original hook
    const durationRes = await runProcess('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', normalizedLocal]);
    const duration = Number((durationRes.stdout || '').trim()) || 0;
    // merge cuts and hook into a removal list
    const removals = (cuts || []).slice().map(c => ({ start: c.start, end: c.end }));
    // also remove original hook
    if (hook && typeof hook.start === 'number')
        removals.push({ start: hook.start, end: hook.end });
    // sort removals
    removals.sort((a, b) => a.start - b.start);
    // build keep intervals by inverting removals
    const keeps = [];
    let cursor = 0;
    for (const r of removals) {
        if (r.start > cursor)
            keeps.push({ start: cursor, end: Math.max(cursor, r.start) });
        cursor = Math.max(cursor, r.end);
    }
    if (cursor < duration)
        keeps.push({ start: cursor, end: duration });
    // prepare temp dir and segment files
    const tmpDir = path_1.default.resolve(process.cwd(), 'tmp', 'renders', `segments-${Date.now()}`);
    fs_1.default.mkdirSync(tmpDir, { recursive: true });
    const segmentFiles = [];
    // first segment is the hook (moved to front)
    const hookFile = path_1.default.join(tmpDir, 'seg-hook.mp4');
    await runProcess('ffmpeg', ['-y', '-hide_banner', '-nostats', '-ss', String(hook.start), '-to', String(hook.end), '-i', normalizedLocal, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '192k', hookFile]);
    segmentFiles.push(hookFile);
    // then each keep interval in order
    let idx = 0;
    for (const k of keeps) {
        // skip empty intervals
        if (k.end - k.start < 0.05)
            continue;
        const fname = path_1.default.join(tmpDir, `seg-${idx}.mp4`);
        await runProcess('ffmpeg', ['-y', '-hide_banner', '-nostats', '-ss', String(k.start), '-to', String(k.end), '-i', normalizedLocal, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '192k', fname]);
        segmentFiles.push(fname);
        idx += 1;
    }
    // create concat list
    const listFile = path_1.default.join(tmpDir, 'list.txt');
    fs_1.default.writeFileSync(listFile, segmentFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    // run concat demuxer
    await runProcess('ffmpeg', ['-y', '-hide_banner', '-nostats', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outLocal]);
    return outLocal;
}
exports.default = { renderEditedVideo };
