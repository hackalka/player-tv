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

function byteStream(client, kind, a, b, group, start, end) {
    let position = start;
    return new ReadableStream({
        async pull(controller) {
            if (position > end) {
                controller.close();
                return;
            }
            const length = Math.min(CHUNK, end - position + 1);
            try {
                const data = await ask(client, { op: 'chunk', kind, a, b, group, start: position, length });
                if (!data || !data.byteLength) throw new Error('Telegram devolvió un bloque vacío');
                const chunk = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
                controller.enqueue(chunk);
                position += chunk.byteLength;
                if (position > end) controller.close();
            } catch (e) {
                controller.error(e);
            }
        }
    });
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const m = url.pathname.match(/\/(tgstream|tgstreamlink|tgthumb|tgthumblink)\/([^/]+)\/([^/?#]+)/);
    if (!m) return;
    event.respondWith(handle(event, m[1], m[2], m[3], url.searchParams.get('group') || ''));
});

async function handle(event, kind, a, b, group) {
    const client = await getClient(event.clientId);
    if (!client) return new Response('No client', { status: 503 });

    const url = new URL(event.request.url);
    const isDownload = url.searchParams.has('download');

    // Miniaturas
    if (kind === 'tgthumb' || kind === 'tgthumblink') {
        const buf = await ask(client, { op: 'thumb', kind, a, b, group }).catch(() => null);
        if (!buf) return new Response('', { status: 404 });
        return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' } });
    }

    // Streaming de video con Range
    const info = await ask(client, { op: 'info', kind, a, b, group }).catch(() => null);
    if (!info || !info.size) return new Response('No info', { status: 404 });
    const size = info.size;

    // ---- DESCARGA COMPLETA (por bloques, con Content-Disposition) ----
    // Para formatos no reproducibles en el navegador (mkv/avi/etc): el usuario
    // descarga el archivo por bloques y lo abre con su reproductor del sistema.
    if (isDownload) {
        const fn = (info.filename || ('telegram_' + b)).replace(/["\r\n]/g, '');
        return new Response(byteStream(client, kind, a, b, group, 0, size - 1), {
            headers: {
                'Content-Type': info.mime || 'application/octet-stream',
                'Content-Length': String(size),
                'Accept-Ranges': 'bytes',
                'Content-Disposition': `attachment; filename="${fn}"`
            }
        });
    }

    let range = event.request.headers.get('range');
    let start = 0, end = size - 1;
    if (range) {
        const r = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
        if (!r) {
            range = null;
        } else if (!r[1] && !r[2]) {
            return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        } else if (!r[1]) {
            const suffixLength = Number(r[2]);
            if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
                return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
            }
            start = Math.max(size - suffixLength, 0);
        } else {
            start = Number(r[1]);
            end = r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
        }
    }
    if (start >= size || start < 0) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) {
        return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }

    const headers = {
        'Content-Type': info.mime || 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1)
    };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(byteStream(client, kind, a, b, group, start, end), {
        status: range ? 206 : 200,
        headers
    });
}
