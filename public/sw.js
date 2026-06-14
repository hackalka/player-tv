/* Service Worker: sirve el vídeo de Telegram por rangos pidiéndoselo a la página. */
const META = new Map(); // streamId -> { size, mime }
const CHUNK = 1024 * 1024; // 1 MB por petición de rango

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'REGISTER') META.set(d.streamId, { size: d.size, mime: d.mime });
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    const idx = url.pathname.indexOf('tg-stream/');
    if (idx === -1) return;
    const streamId = url.pathname.slice(idx + 'tg-stream/'.length);
    e.respondWith(handle(e, streamId));
});

async function handle(event, streamId) {
    const meta = META.get(streamId);
    if (!meta) return new Response('stream no registrado', { status: 404 });
    const size = meta.size, mime = meta.mime;

    const rangeHeader = event.request.headers.get('Range');
    let start = 0, end = size - 1;
    if (rangeHeader) {
        const m = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
        if (m) { start = parseInt(m[1], 10); if (m[2]) end = Math.min(parseInt(m[2], 10), size - 1); }
    }
    // limitar el tamaño de cada respuesta para no descargar de golpe
    end = Math.min(end, start + CHUNK - 1, size - 1);
    if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });

    let data;
    try { data = await requestRange(event.clientId, streamId, start, end); }
    catch (err) { return new Response('error: ' + (err && err.message), { status: 500 }); }

    return new Response(data, {
        status: 206,
        headers: {
            'Content-Type': mime,
            'Content-Length': String(end - start + 1),
            'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store'
        }
    });
}

async function requestRange(clientId, streamId, start, end) {
    const client = (clientId && await self.clients.get(clientId)) || (await self.clients.matchAll())[0];
    if (!client) throw new Error('sin página');
    return await new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => reject(new Error('timeout rango')), 60000);
        channel.port1.onmessage = (ev) => {
            clearTimeout(timer);
            if (ev.data && ev.data.error) reject(new Error(ev.data.error));
            else resolve(ev.data.chunk);
        };
        client.postMessage({ type: 'RANGE', streamId, start, end }, [channel.port2]);
    });
}
