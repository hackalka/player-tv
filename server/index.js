'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const express = require('express');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const cfg = require('./config');
const { TelegramService } = require('./telegram');

const app = express();
app.disable('x-powered-by');
app.use(express.json());
// Cabeceras de seguridad básicas
app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
});
const tg = new TelegramService(cfg);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ALIGN = 4096;

// Caché de miniaturas en disco (rapidez)
const THUMB_DIR = path.join(os.tmpdir(), 'tvp-thumbs');
try { fs.mkdirSync(THUMB_DIR, { recursive: true }); } catch {}
async function serveThumb(res, key, downloader) {
    const file = path.join(THUMB_DIR, key.replace(/[^\w-]/g, '_') + '.jpg');
    try {
        const data = await fsp.readFile(file);
        res.set('Content-Type', 'image/jpeg'); res.set('Cache-Control', 'public, max-age=604800');
        return res.send(data);
    } catch {}
    let buf;
    try { buf = await downloader(); } catch (e) { console.warn('thumb dl', e.message); }
    if (!buf) return res.status(404).end();
    const b = Buffer.from(buf);
    fsp.writeFile(file, b).catch(() => {});
    res.set('Content-Type', 'image/jpeg'); res.set('Cache-Control', 'public, max-age=604800');
    res.send(b);
}

// ¿Falta la sesión? -> modo configuración (asistente web en /setup)
const setupMode = !cfg.session;
let setupClient = null, setupPhone = null, setupHash = null;

// ---- estado / salud ----
app.get('/api/health', (req, res) => {
    res.json({ ok: tg.ready, app: cfg.appName, setupMode });
});

// ---- info de la app (marca) ----
app.get('/api/app', (req, res) => {
    res.json({ appName: cfg.appName, setupMode, adminEnabled: !!cfg.adminPassword });
});

// ---- autenticación de administrador ----
function isAdmin(req) {
    return !!cfg.adminPassword && (req.headers['x-admin-key'] === cfg.adminPassword
        || (req.body && req.body.password === cfg.adminPassword));
}
function adminOnly(req, res, next) {
    if (!cfg.adminPassword) return res.status(403).json({ error: 'Administración desactivada.' });
    if (!isAdmin(req)) return res.status(401).json({ error: 'No autorizado.' });
    next();
}

app.post('/api/admin/login', (req, res) => {
    if (!cfg.adminPassword) return res.status(403).json({ error: 'Administración desactivada.' });
    if (!isAdmin(req)) return res.status(401).json({ error: 'Contraseña incorrecta.' });
    res.json({ ok: true });
});

app.post('/api/admin/edit', adminOnly, async (req, res) => {
    try {
        await tg.editMessageText(req.body.msgId, req.body.text || '');
        invalidateCatalog();
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.errorMessage || e.message }); }
});

app.post('/api/admin/delete', adminOnly, async (req, res) => {
    try {
        await tg.deleteMessage(req.body.msgId);
        invalidateCatalog();
        if (req.body.topicId != null) delete chatCache[req.body.topicId];
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.errorMessage || e.message }); }
});

app.post('/api/admin/refresh', adminOnly, (req, res) => { invalidateCatalog(); chatCache = {}; res.json({ ok: true }); });

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
let chatCache = {};
function invalidateCatalog() { catalogCache = null; catalogTime = 0; }

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

// ---- temas del foro (solo los etiquetados, vista chat) — SOLO ADMIN ----
app.get('/api/topics', adminOnly, async (req, res) => {
    try {
        const topics = await tg.getAutoTopics();
        res.json({ topics: topics.map(t => ({ id: t.id, title: t.name, icon: t.icon })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- mensajes de un tema (vista chat estilo Telegram) — SOLO ADMIN ----
app.get('/api/chat/:topicId', adminOnly, async (req, res) => {
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
        chatCache[req.params.topicId] = out;
        res.json({ messages: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- miniatura ----
app.get('/api/thumb/:topicId/:msgId', (req, res) => {
    serveThumb(res, 'g-' + req.params.topicId + '-' + req.params.msgId,
        () => tg.downloadThumb(req.params.topicId, req.params.msgId));
});

// ---- miniatura de un mensaje de OTRO canal (enlace t.me) ----
app.get('/api/thumb-link/:channel/:msgId', (req, res) => {
    serveThumb(res, 'l-' + req.params.channel + '-' + req.params.msgId, async () => {
        const message = await tg.getMessageByRef(req.params.channel, req.params.msgId);
        if (!message || !message.media) return null;
        const doc = message.media.document;
        if (message.media.photo) return await tg.client.downloadMedia(message, {});
        if (doc && doc.thumbs && doc.thumbs.length) return await tg.client.downloadMedia(message, { thumb: doc.thumbs.length - 1 });
        return null;
    });
});

// función reutilizable de streaming por rangos
async function streamMessage(message, req, res) {
    if (!message) return res.status(404).end();
    const info = tg.docInfo(message);
    if (!info) return res.status(415).end('No es un archivo reproducible');

    const size = info.size;
    const range = req.headers.range;
    let start = 0, end = size - 1;
    if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        if (m) { start = parseInt(m[1], 10); if (m[2]) end = Math.min(parseInt(m[2], 10), size - 1); }
    }
    if (start >= size || start < 0) { res.status(416).set('Content-Range', `bytes */${size}`).end(); return; }
    const chunkSize = end - start + 1;

    res.writeHead(range ? 206 : 200, {
        'Content-Type': info.mimeType,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
    });

    const alignedStart = Math.floor(start / ALIGN) * ALIGN;
    let skip = start - alignedStart;
    let toWrite = chunkSize;
    let pos = alignedStart;
    let remaining = Math.ceil((skip + chunkSize) / ALIGN) * ALIGN;
    let attempts = 0;

    while (toWrite > 0 && !res.writableEnded) {
        try {
            const iterator = tg.streamRange(info, pos, remaining);
            for await (const chunk of iterator) {
                if (res.writableEnded) break;
                let buf = Buffer.from(chunk);
                pos += buf.length; remaining -= buf.length;
                if (skip > 0) { if (skip >= buf.length) { skip -= buf.length; continue; } buf = buf.subarray(skip); skip = 0; }
                if (buf.length > toWrite) buf = buf.subarray(0, toWrite);
                const ok = res.write(buf);
                toWrite -= buf.length;
                if (!ok) await new Promise(r => res.once('drain', r));
                if (toWrite <= 0) break;
            }
            break;
        } catch (e) {
            if (++attempts > 2) throw e;
            console.warn('reintentando stream (' + attempts + '):', e.message);
            await new Promise(r => setTimeout(r, 400));
        }
    }
    res.end();
}

// ---- STREAMING de video por rangos (mensaje del grupo) ----
app.get('/api/stream/:topicId/:msgId', async (req, res) => {
    try { await streamMessage(await tg.getMessageById(req.params.msgId), req, res); }
    catch (e) { console.error('stream error', e.message); if (!res.headersSent) res.status(500).end(); else res.end(); }
});

// ---- STREAMING de un mensaje de OTRO canal (enlace t.me) ----
app.get('/api/stream-link/:channel/:msgId', async (req, res) => {
    try { await streamMessage(await tg.getMessageByRef(req.params.channel, req.params.msgId), req, res); }
    catch (e) { console.error('stream-link error', e.message); if (!res.headersSent) res.status(500).end(); else res.end(); }
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
