'use strict';
const path = require('path');
const express = require('express');
const cfg = require('./config');
const { TelegramService } = require('./telegram');

const app = express();
const tg = new TelegramService(cfg);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ALIGN = 4096;

// ---- estado / salud ----
app.get('/api/health', (req, res) => {
    res.json({ ok: tg.ready, app: cfg.appName });
});

// ---- info de la app (marca + categorías) ----
app.get('/api/app', (req, res) => {
    res.json({
        appName: cfg.appName,
        categories: cfg.topics.map(t => ({ name: t.name, icon: t.icon, type: t.type, id: t.id }))
    });
});

// ---- catálogo completo estilo Netflix ----
let catalogCache = null;
let catalogTime = 0;
app.get('/api/catalog', async (req, res) => {
    try {
        const fresh = req.query.refresh === '1';
        if (!catalogCache || fresh || Date.now() - catalogTime > 60_000) {
            catalogCache = await tg.getCatalog();
            catalogTime = Date.now();
        }
        res.json(catalogCache);
    } catch (e) {
        console.error('catalog error', e);
        res.status(500).json({ error: e.message });
    }
});

// ---- temas del foro (vista chat) ----
app.get('/api/topics', async (req, res) => {
    try { res.json({ topics: await tg.getForumTopics() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- mensajes de un tema (vista chat estilo Telegram) ----
app.get('/api/chat/:topicId', async (req, res) => {
    try {
        const msgs = await tg.getTopicMessages(req.params.topicId, 60);
        const out = msgs.map(m => {
            const doc = m.media && m.media.document;
            const isVideo = !!(doc && /video/.test(doc.mimeType || ''));
            const hasThumb = !!(m.media && (m.media.photo || (doc && doc.thumbs && doc.thumbs.length)));
            return {
                id: m.id,
                text: m.message || '',
                date: m.date,
                hasMedia: !!m.media,
                isVideo,
                thumbUrl: hasThumb ? `/api/thumb/${req.params.topicId}/${m.id}` : '',
                streamUrl: isVideo ? `/api/stream/${req.params.topicId}/${m.id}` : ''
            };
        });
        res.json({ messages: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- miniatura ----
app.get('/api/thumb/:topicId/:msgId', async (req, res) => {
    try {
        const buf = await tg.downloadThumb(req.params.topicId, req.params.msgId);
        if (!buf) return res.status(404).end();
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(Buffer.from(buf));
    } catch (e) {
        console.warn('thumb error', e.message);
        res.status(500).end();
    }
});

// ---- STREAMING de video por rangos ----
app.get('/api/stream/:topicId/:msgId', async (req, res) => {
    try {
        const message = await tg.getMessageById(req.params.msgId);
        if (!message) return res.status(404).end();
        const info = tg.docInfo(message);
        if (!info) return res.status(415).end('No es un archivo reproducible');

        const size = info.size;
        const range = req.headers.range;
        let start = 0, end = size - 1;
        if (range) {
            const m = /bytes=(\d+)-(\d*)/.exec(range);
            if (m) {
                start = parseInt(m[1], 10);
                if (m[2]) end = Math.min(parseInt(m[2], 10), size - 1);
            }
        }
        if (start >= size || start < 0) {
            res.status(416).set('Content-Range', `bytes */${size}`).end();
            return;
        }
        const chunkSize = end - start + 1;

        res.writeHead(range ? 206 : 200, {
            'Content-Type': info.mimeType,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
        });

        // Alineamos la descarga a múltiplos de 4096 (requisito de Telegram)
        const alignedStart = Math.floor(start / ALIGN) * ALIGN;
        let skip = start - alignedStart;
        let toWrite = chunkSize;
        let downloadLimit = Math.ceil((skip + chunkSize) / ALIGN) * ALIGN;

        const iterator = tg.streamRange(info, alignedStart, downloadLimit);
        for await (const chunk of iterator) {
            if (res.writableEnded) break;
            let buf = Buffer.from(chunk);
            if (skip > 0) {
                if (skip >= buf.length) { skip -= buf.length; continue; }
                buf = buf.subarray(skip); skip = 0;
            }
            if (buf.length > toWrite) buf = buf.subarray(0, toWrite);
            const ok = res.write(buf);
            toWrite -= buf.length;
            if (!ok) await new Promise(r => res.once('drain', r));
            if (toWrite <= 0) break;
        }
        res.end();
    } catch (e) {
        console.error('stream error', e.message);
        if (!res.headersSent) res.status(500).end();
        else res.end();
    }
});

// ---- frontend estático ----
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ---- arranque ----
(async () => {
    try {
        await tg.start();
    } catch (e) {
        console.error('⚠️  No se pudo iniciar Telegram:', e.message);
        console.error('   El servidor sigue arrancando para mostrar el error en /api/health.');
    }
    app.listen(cfg.port, () => {
        console.log(`🚀 ${cfg.appName} escuchando en el puerto ${cfg.port}`);
    });
})();
