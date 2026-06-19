/* ===================================================================
 * Service Worker: sirve video (con Range/seek) y miniaturas de Telegram.
 * No tiene la sesion; pide los bytes a la pagina (tg-app.js) via MessageChannel,
 * que los descarga con GramJS directamente desde Telegram.
 * =================================================================== */
const CHUNK = 2 * 1024 * 1024; // tamaño máximo por petición de rango

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function ask(client, msg) {
    return new Promise((resolve, reject) => {
        const ch = new MessageChannel();
        const t = setTimeout(() => reject(new Error('timeout')), 60000);
        ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
        client.postMessage(msg, [ch.port2]);
    });
}

async function getClient(id) {
    let c = id && await self.clients.get(id);
    if (c) return c;
    const all = await self.clients.matchAll({ type: 'window' });
    return all[0];
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const m = url.pathname.match(/\/(tgstream|tgstreamlink|tgthumb|tgthumblink)\/([^/]+)\/([^/?#]+)/);
    if (!m) return;
    event.respondWith(handle(event, m[1], m[2], m[3]));
});

async function handle(event, kind, a, b) {
    const client = await getClient(event.clientId);
    if (!client) return new Response('No client', { status: 503 });

    // Miniaturas
    if (kind === 'tgthumb' || kind === 'tgthumblink') {
        const buf = await ask(client, { op: 'thumb', kind, a, b }).catch(() => null);
        if (!buf) return new Response('', { status: 404 });
        return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' } });
    }

    // Streaming de video con Range
    const info = await ask(client, { op: 'info', kind, a, b }).catch(() => null);
    if (!info || !info.size) return new Response('No info', { status: 404 });
    const size = info.size;

    const range = event.request.headers.get('range');
    let start = 0, end = size - 1;
    if (range) {
        const r = /bytes=(\d+)-(\d*)/.exec(range);
        if (r) { start = parseInt(r[1], 10); if (r[2]) end = Math.min(parseInt(r[2], 10), size - 1); }
    }
    if (start >= size || start < 0) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });

    end = Math.min(end, start + CHUNK - 1, size - 1);
    const length = end - start + 1;

    const buf = await ask(client, { op: 'chunk', kind, a, b, start, length }).catch(() => null);
    if (!buf) return new Response('Chunk error', { status: 500 });

    return new Response(buf, {
        status: 206,
        headers: {
            'Content-Type': info.mime || 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Length': String(buf.byteLength || length),
            'Content-Range': `bytes ${start}-${end}/${size}`
        }
    });
}
