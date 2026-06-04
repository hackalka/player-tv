// TelegramFlix Service Worker — True Range-Request Streaming
const streams = new Map();
const pending = new Map();
let port = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

self.addEventListener('message', (e) => {
    const { type } = e.data || {};
    if (type === 'INIT') {
        port = e.ports[0];
        port.onmessage = (ev) => {
            const { requestId, chunk, error } = ev.data;
            const p = pending.get(requestId);
            if (!p) return;
            pending.delete(requestId);
            if (error) p.reject(new Error(error));
            else p.resolve(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk);
        };
        port.postMessage({ type: 'READY' });
    }
    if (type === 'REGISTER') {
        streams.set(e.data.streamId, {
            fileSize: e.data.fileSize,
            mimeType: e.data.mimeType,
        });
    }
});

function fetchChunk(streamId, start, size) {
    return new Promise((resolve, reject) => {
        if (!port) return reject(new Error('Port not ready'));
        const requestId = `${streamId}-${start}-${Date.now()}`;
        pending.set(requestId, { resolve, reject });
        port.postMessage({ type: 'FETCH_RANGE', requestId, streamId, start, size });
        setTimeout(() => {
            if (pending.has(requestId)) {
                pending.delete(requestId);
                reject(new Error('Timeout'));
            }
        }, 30000);
    });
}

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    const TG_MARKER = 'tg-stream/';
    const markerIdx = url.pathname.indexOf(TG_MARKER);
    if (markerIdx === -1) return;

    const streamId = url.pathname.slice(markerIdx + TG_MARKER.length);
    const meta = streams.get(streamId);
    if (!meta || !port) {
        e.respondWith(new Response('Stream not ready', { status: 503 }));
        return;
    }

    const rangeHeader = e.request.headers.get('range') || '';
    let start = 0;
    let end = meta.fileSize - 1;

    if (rangeHeader) {
        const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (m) {
            start = parseInt(m[1]);
            end = m[2] ? Math.min(parseInt(m[2]), meta.fileSize - 1) : meta.fileSize - 1;
        }
    }

    const CHUNK_SIZE = 1024 * 1024;
    const totalRequested = end - start + 1;

    let pos = start;
    const readableStream = new ReadableStream({
        async pull(controller) {
            if (pos > end) {
                controller.close();
                return;
            }
            const size = Math.min(CHUNK_SIZE, end - pos + 1);
            try {
                const chunk = await fetchChunk(streamId, pos, size);
                controller.enqueue(chunk);
                pos += chunk.byteLength;
                if (pos > end) controller.close();
            } catch (err) {
                controller.error(err);
            }
        }
    });

    const headers = {
        'Content-Type': meta.mimeType || 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(totalRequested),
        'Content-Range': `bytes ${start}-${end}/${meta.fileSize}`,
    };

    e.respondWith(new Response(readableStream, {
        status: rangeHeader ? 206 : 200,
        headers,
    }));
});
