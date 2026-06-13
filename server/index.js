'use strict';
const path = require('path');
const express = require('express');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const cfg = require('./config');
const { TelegramService } = require('./telegram');

const app = express();
app.use(express.json());
const tg = new TelegramService(cfg);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ALIGN = 4096;

// ¿Falta la sesión? -> modo configuración (asistente web en /setup)
const setupMode = !cfg.session;
let setupClient = null, setupPhone = null, setupHash = null;

// ---- estado / salud ----
app.get('/api/health', (req, res) => {
    res.json({ ok: tg.ready, app: cfg.appName, setupMode });
});

// ---- info de la app (marca) ----
app.get('/api/app', (req, res) => {
    res.json({ appName: cfg.appName, setupMode });
});

/* =========================================================
 *  ASISTENTE DE CONFIGURACIÓN (genera TG_SESSION sin PC)
 *  Solo activo mientras NO exista TG_SESSION.
 * ========================================================= */
function ensureSetup(res) {
    if (!setupMode) { res.status(403).json({ error: 'La sesión ya está configurada.' }); return false; }
    return true;
}

app.post('/api/setup/send-code', async (req, res) => {
    if (!ensureSetup(res)) return;
    try {
        const phone = String(req.body.phone || '').trim();
        if (!phone) return res.status(400).json({ error: 'Escribe tu número con prefijo (ej: +34...).' });
        setupClient = new TelegramClient(new StringSession(''), cfg.apiId, cfg.apiHash, { connectionRetries: 5 });
        await setupClient.connect();
        const r = await setupClient.sendCode({ apiId: cfg.apiId, apiHash: cfg.apiHash }, phone);
        setupPhone = phone; setupHash = r.phoneCodeHash;
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.errorMessage || e.message }); }
});

app.post('/api/setup/sign-in', async (req, res) => {
    if (!ensureSetup(res)) return;
    try {
        if (!setupClient) return res.status(400).json({ error: 'Primero pide el código.' });
        const code = String(req.body.code || '').replace(/\s+/g, '');
        await setupClient.invoke(new Api.auth.SignIn({
            phoneNumber: setupPhone, phoneCodeHash: setupHash, phoneCode: code
        }));
        res.json({ ok: true, session: setupClient.session.save() });
    } catch (e) {
        const msg = e.errorMessage || e.message || '';
        if (msg.includes('SESSION_PASSWORD_NEEDED')) return res.json({ needPassword: true });
        res.status(500).json({ error: msg });
    }
});

app.post('/api/setup/password', async (req, res) => {
    if (!ensureSetup(res)) return;
    try {
        if (!setupClient) return res.status(400).json({ error: 'Primero pide el código.' });
        const password = String(req.body.password || '');
        let used = false;
        await setupClient.signInWithPassword(
            { apiId: cfg.apiId, apiHash: cfg.apiHash },
            {
                password: async () => { if (used) throw new Error('Contraseña 2FA incorrecta.'); used = true; return password; },
                onError: (e) => { throw e; }
            }
        );
        res.json({ ok: true, session: setupClient.session.save() });
    } catch (e) { res.status(500).json({ error: e.errorMessage || e.message }); }
});

// En modo configuración, la raíz muestra el asistente
app.get(['/', '/setup'], (req, res, next) => {
    if (setupMode) return res.sendFile(path.join(PUBLIC_DIR, 'setup.html'));
    next();
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

// ---- temas del foro (solo los etiquetados, vista chat) ----
app.get('/api/topics', async (req, res) => {
    try {
        const topics = await tg.getAutoTopics();
        res.json({ topics: topics.map(t => ({ id: t.id, title: t.name, icon: t.icon })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, setupMode ? 'setup.html' : 'index.html'));
});

// ---- arranque ----
(async () => {
    if (setupMode) {
        console.warn('⚙️  Sin TG_SESSION: modo CONFIGURACIÓN activo. Abre la web y sigue el asistente.');
    } else {
        try {
            await tg.start();
        } catch (e) {
            console.error('⚠️  No se pudo iniciar Telegram:', e.message);
            console.error('   El servidor sigue arrancando para mostrar el error en /api/health.');
        }
    }
    app.listen(cfg.port, () => {
        console.log(`🚀 ${cfg.appName} escuchando en el puerto ${cfg.port}`);
    });
})();
