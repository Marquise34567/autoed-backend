"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.GET = GET;
const server_1 = require("next/server");
const jobs_1 = require("@/lib/jobs");
const authServer_1 = require("@/lib/authServer");
exports.runtime = 'nodejs';
function formatSSE(obj) {
    try {
        return `data: ${JSON.stringify(obj)}\n\n`;
    }
    catch (e) {
        return `data: ${String(obj)}\n\n`;
    }
}
function formatSSEEvent(eventName, obj) {
    try {
        return `event: ${eventName}\n` + `data: ${JSON.stringify(obj)}\n\n`;
    }
    catch (e) {
        return `event: ${eventName}\n` + `data: ${String(obj)}\n\n`;
    }
}
async function GET(request, { params }) {
    const { jobId } = await params;
    if (!jobId)
        return server_1.NextResponse.json({ error: 'missing jobId' }, { status: 400 });
    // Verify auth (allow ?token= in dev for EventSource clients)
    try {
        await (0, authServer_1.requireAuth)(request, { allowQueryTokenInDev: true });
    }
    catch (authErr) {
        // Return an SSE response with an immediate error event and then close
        const headers = new Headers({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
        const encoder = globalThis.TextEncoder ? new TextEncoder() : { encode: (s) => Buffer.from(s) };
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ phase: 'ERROR', message: 'Unauthorized' })}\n\n`));
                try {
                    controller.close();
                }
                catch (_) { }
            }
        });
        return new Response(stream, { headers });
    }
    const headers = new Headers({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
    });
    // Ensure first event is sent quickly (within ~200ms) and heartbeat every 15s
    try {
        const encoder = globalThis.TextEncoder ? new TextEncoder() : { encode: (s) => Buffer.from(s) };
        const stream = new ReadableStream({
            start(controller) {
                let closed = false;
                let lastSentAt = Date.now();
                const send = (payload) => {
                    try {
                        controller.enqueue(encoder.encode(formatSSE(payload)));
                        lastSentAt = Date.now();
                    }
                    catch (e) {
                        // swallow
                    }
                };
                // Send initial snapshot quickly
                (async () => {
                    try {
                        const j = await (0, jobs_1.getJob)(jobId);
                        if (j) {
                            send({ type: 'snapshot', job: j });
                        }
                        else {
                            send({ type: 'snapshot', job: { phase: 'ERROR', message: 'Job not found' } });
                        }
                    }
                    catch (e) {
                        try {
                            send({ type: 'error', message: 'Failed to read job' });
                        }
                        catch (_) { }
                    }
                })();
                // Poll loop: Firestore-backed job read every 400ms
                const pollInterval = 400;
                const iv = setInterval(async () => {
                    try {
                        const j = await (0, jobs_1.getJob)(jobId);
                        if (j) {
                            // regular update
                            send({ type: 'update', job: j });
                            const st = String((j.phase || j.status || '')).toUpperCase();
                            if (st === 'DONE' || st === 'ERROR' || st === 'FAILED') {
                                // send an explicit done event with job payload to avoid client interpreting close as error
                                try {
                                    controller.enqueue(encoder.encode(formatSSEEvent('done', { job: j })));
                                }
                                catch (_) { }
                                // then close gracefully
                                clearInterval(iv);
                                clearInterval(hb);
                                try {
                                    controller.close();
                                }
                                catch (_) { }
                                closed = true;
                            }
                        }
                        else {
                            // If job missing, send an error snapshot but keep polling (it may be created shortly)
                            send({ type: 'update', job: { phase: 'ERROR', message: 'Job not found' } });
                        }
                    }
                    catch (e) {
                        try {
                            send({ type: 'error', message: 'poll error' });
                        }
                        catch (_) { }
                    }
                }, pollInterval);
                // Heartbeat every 15s
                const hb = setInterval(() => {
                    try {
                        // If nothing sent recently, emit a ping
                        if (Date.now() - lastSentAt > 14000) {
                            send({ type: 'heartbeat', ts: Date.now() });
                        }
                    }
                    catch (_) { }
                }, 15000);
                const cleanup = () => {
                    if (closed)
                        return;
                    closed = true;
                    clearInterval(iv);
                    clearInterval(hb);
                    try {
                        controller.close();
                    }
                    catch (_) { }
                };
                // Hook request abort
                try {
                    const sig = request.signal;
                    if (sig && typeof sig.addEventListener === 'function')
                        sig.addEventListener('abort', cleanup);
                }
                catch (_) { }
            },
            cancel() {
                // noop
            },
        });
        return new Response(stream, { headers });
    }
    catch (err) {
        return server_1.NextResponse.json({ error: 'SSE handler failed', details: String(err) }, { status: 500 });
    }
}
