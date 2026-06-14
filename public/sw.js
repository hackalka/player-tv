// Tv Player — Service Worker de streaming por rangos (puerto persistente + ReadableStream)
// Sirve /tg-stream/{streamId} con soporte HTTP Range real, pidiendo los trozos
// (1 MB) a la página principal por un MessagePort y entregándolos de forma progresiva.

const streams = new Map();   // streamId -> { fileSize, mimeType }
const pending = new Map();   // requestId -> { resolve, reject }
let port = null;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'INIT') {
        port = e.ports[0];
        port.onmessage = (ev) => {
            const { requestId, chunk, error } = ev.data || {};
            const p = pending.get(requestId);
            if (!p) return;
            pending.delete(requestId);
            if (error) p.reject(new Error(error));
            else p.resolve(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk);
        };
        port.postMessage({ type: 'READY' });
    } else if (d.type === 'REGISTER') {
        streams.set(d.streamId, { fileSize: d.fileSize, mimeType: d.mimeType });
    }
});

function fetchChunk(streamId, start, size) {
    return new Promise((resolve, reject) => {
        if (!port) { reject(new Error('Puerto no listo')); return; }
        const requestId = streamId + '-' + start + '-' + Date.now() + '-' + Math.random();
        pending.set(requestId, { resolve, reject });
        port.postMessage({ type: 'FETCH_RANGE', requestId, streamId, start, size });
        setTimeout(() => { if (pending.has(requestId)) { pending.delete(requestId); reject(new Error('Timeout')); } }, 45000);
    });
}

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    const idx = url.pathname.indexOf('tg-stream/');
    if (idx === -1) return;
    const streamId = url.pathname.slice(idx + 'tg-stream/'.length);
    e.respondWith(handle(e, streamId));
});

async function handle(e, streamId) {
    let meta = streams.get(streamId);
    // esperar al REGISTER por si el <video> pide antes (carrera)
    for (let i = 0; i < 40 && !meta; i++) { await sleep(50); meta = streams.get(streamId); }
    if (!meta || !port) return new Response('Stream no listo', { status: 503 });

    const size = meta.fileSize;
    const mime = meta.mimeType || 'video/mp4';
    const rangeHeader = e.request.headers.get('range') || '';
    let start = 0, end = size - 1;
    if (rangeHeader) {
        const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (m) { start = parseInt(m[1], 10); end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1; }
    }
    const CHUNK = 1024 * 1024;
    const total = end - start + 1;
    let pos = start;

    const stream = new ReadableStream({
        async pull(controller) {
            if (pos > end) { controller.close(); return; }
            const sz = Math.min(CHUNK, end - pos + 1);
            try {
                const chunk = await fetchChunk(streamId, pos, sz);
                if (!chunk || !chunk.byteLength) { controller.close(); return; }
                controller.enqueue(chunk);
                pos += chunk.byteLength;
                if (pos > end) controller.close();
            } catch (err) { controller.error(err); }
        }
    });

    return new Response(stream, {
        status: rangeHeader ? 206 : 200,
        headers: {
            'Content-Type': mime,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(total),
            'Content-Range': `bytes ${start}-${end}/${size}`
        }
    });
}
