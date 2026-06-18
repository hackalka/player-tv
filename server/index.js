'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const express = require('express');
const cfg = require('./config');
const { SessionManager } = require('./sessions');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json());
app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
});

const sessions = new SessionManager(cfg);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ALIGN = 4096;

// ---- cookies ----
function getToken(req) {
    const c = req.headers.cookie || '';
    const m = c.match(/(?:^|;\s*)tvp=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
    // Fallback: header (para clientes que pierden la cookie, p. ej. PWAs/incógnito)
    return req.headers['x-auth-token'] || '';
}
function setTokenCookie(res, token) {
    // Sin "Secure" obligatorio para que funcione tras proxies/incógnito; con "Lax" es suficiente
    res.append('Set-Cookie', `tvp=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=63072000`);
}
function clearTokenCookie(res) {
    res.append('Set-Cookie', 'tvp=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

// ---- middlewares de auth ----
async function withUser(req, res, next) {
    const token = getToken(req);
    if (!token) return res.status(401).json({ needLogin: true });
    // Si no tenemos persisted, NO hay sesión real -> login
    if (!sessions.persisted || !sessions.persisted[token]) return res.status(401).json({ needLogin: true });
    try {
        const u = await sessions.getByToken(token);
        if (!u) {
            // La sesión está persistida pero no se pudo restaurar (timeout/red).
            // Devolvemos 503 transitorio: el cliente reintenta sin enviar al login.
            return res.status(503).json({ retry: true, error: 'Reconectando con Telegram, intenta de nuevo en unos segundos.' });
        }
        if (!u.inGroup) return res.status(403).json({ needAccess: true, error: 'Tu cuenta no es miembro del grupo. Pide al administrador que te añada.' });
        req.user = u; next();
    } catch (e) {
        // Error transitorio -> 503 (no echar al usuario)
        res.status(503).json({ retry: true, error: e.message });
    }
}
function adminOnly(req, res, next) {
    if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Solo para administradores del grupo.' });
    next();
}

// ---- caché de miniaturas en disco ----
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

/* ===================== PÚBLICO ===================== */
app.get('/api/app', (req, res) => res.json({ appName: cfg.appName }));

app.get('/api/me', (req, res) => {
    const token = getToken(req);
    if (!token) return res.json({ loggedIn: false });
    // Comprobación ligera (sin contactar a Telegram). Si el token está persistido, confiamos.
    if (sessions.users && sessions.users.has(token)) {
        const u = sessions.users.get(token);
        return res.json({ loggedIn: true, isAdmin: u.isAdmin, name: u.name, inGroup: !!u.inGroup });
    }
    if (sessions.persisted && sessions.persisted[token]) {
        return res.json({ loggedIn: true, isAdmin: false, name: '', inGroup: true, _restoring: true });
    }
    res.json({ loggedIn: false });
});

/* ===================== LOGIN (por usuario) ===================== */
app.post('/api/login/start', async (req, res) => {
    try { res.json({ loginId: await sessions.startLogin() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/login/send-code', async (req, res) => {
    try {
        const phone = String(req.body.phone || '').trim();
        if (!phone) return res.status(400).json({ error: 'Escribe tu número con prefijo (ej: +34...).' });
        await sessions.sendCode(req.body.loginId, phone);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.errorMessage || e.message }); }
});
app.post('/api/login/sign-in', async (req, res) => {
    try {
        const r = await sessions.signIn(req.body.loginId, req.body.code);
        if (r.needPassword) return res.json({ needPassword: true });
        setTokenCookie(res, r.token);
        res.json({ ok: true, isAdmin: r.isAdmin, name: r.name, token: r.token });
    } catch (e) { res.status(500).json({ error: e.errorMessage || e.message }); }
});
app.post('/api/login/password', async (req, res) => {
    try {
        const r = await sessions.signInPassword(req.body.loginId, String(req.body.password || ''));
        setTokenCookie(res, r.token);
        res.json({ ok: true, isAdmin: r.isAdmin, name: r.name, token: r.token });
    } catch (e) { res.status(500).json({ error: e.errorMessage || e.message }); }
});
app.post('/api/logout', async (req, res) => {
    try { await sessions.logout(getToken(req)); } catch {}
    clearTokenCookie(res);
    res.json({ ok: true });
});

/* ===================== CATÁLOGO (requiere login) ===================== */
let catalogCache = null, catalogTime = 0;
function invalidateCatalog() { catalogCache = null; catalogTime = 0; }

app.get('/api/catalog', withUser, async (req, res) => {
    try {
        const fresh = req.query.refresh === '1';
        if (!catalogCache || fresh || Date.now() - catalogTime > 60000) {
            catalogCache = await req.user.service.getCatalog();
            catalogTime = Date.now();
        }
        res.json(catalogCache);
    } catch (e) { console.error('catalog', e); res.status(500).json({ error: e.message }); }
});

// TMDB: recomendaciones por id (para "Porque viste...")
app.get('/api/tmdb/recommendations/:type/:id', withUser, async (req, res) => {
    try {
        const t = req.params.type === 'tv' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/${t}/${req.params.id}/recommendations?language=es-ES` + (cfg.tmdbToken ? '' : ('&api_key=' + (cfg.tmdbKey || '')));
        const headers = cfg.tmdbToken ? { 'Authorization': 'Bearer ' + cfg.tmdbToken, 'accept': 'application/json' } : { 'accept': 'application/json' };
        const r = await fetch(url, { headers });
        const d = await r.json();
        res.json({ results: (d.results || []).slice(0, 12).map(x => ({
            id: x.id, type: t, title: x.title || x.name,
            year: ((x.release_date || x.first_air_date || '').match(/^(\d{4})/) || [])[1] || '',
            poster: x.poster_path ? 'https://image.tmdb.org/t/p/w500' + x.poster_path : '',
            rating: x.vote_average ? Math.round(x.vote_average * 10) / 10 : ''
        })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// TMDB: próximos estrenos (cine en próximos meses)
app.get('/api/tmdb/upcoming', withUser, async (req, res) => {
    try {
        const url = `https://api.themoviedb.org/3/movie/upcoming?language=es-ES&region=ES&page=1` + (cfg.tmdbToken ? '' : ('&api_key=' + (cfg.tmdbKey || '')));
        const headers = cfg.tmdbToken ? { 'Authorization': 'Bearer ' + cfg.tmdbToken, 'accept': 'application/json' } : { 'accept': 'application/json' };
        const r = await fetch(url, { headers });
        const d = await r.json();
        res.json({ results: (d.results || []).slice(0, 14).map(x => ({
            id: 'up-' + x.id, type: 'movie', title: x.title,
            year: ((x.release_date || '').match(/^(\d{4})/) || [])[1] || '',
            date: x.release_date || '',
            poster: x.poster_path ? 'https://image.tmdb.org/t/p/w500' + x.poster_path : '',
            backdrop: x.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + x.backdrop_path : '',
            description: x.overview || '',
            rating: x.vote_average ? Math.round(x.vote_average * 10) / 10 : ''
        })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===================== CHAT (solo admin del grupo) ===================== */
app.get('/api/topics', withUser, adminOnly, async (req, res) => {
    try {
        const topics = await req.user.service.getAutoTopics();
        res.json({ topics: topics.map(t => ({ id: t.id, title: t.name, icon: t.icon })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/chat/:topicId', withUser, adminOnly, async (req, res) => {
    try {
        const msgs = await req.user.service.getTopicMessages(req.params.topicId, 60);
        const out = msgs.map(m => {
            const doc = m.media && m.media.document;
            const isVideo = !!(doc && /video/.test(doc.mimeType || ''));
            const hasThumb = !!(m.media && (m.media.photo || (doc && doc.thumbs && doc.thumbs.length)));
            return {
                id: m.id, text: m.message || '', date: m.date, hasMedia: !!m.media, isVideo,
                thumbUrl: hasThumb ? `/api/thumb/${req.params.topicId}/${m.id}` : '',
                streamUrl: isVideo ? `/api/stream/${req.params.topicId}/${m.id}` : ''
            };
        });
        res.json({ messages: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/edit', withUser, adminOnly, async (req, res) => {
    try { await req.user.service.editMessageText(req.body.msgId, req.body.text || ''); invalidateCatalog(); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.errorMessage || e.message }); }
});
app.post('/api/admin/delete', withUser, adminOnly, async (req, res) => {
    try { await req.user.service.deleteMessage(req.body.msgId); invalidateCatalog(); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.errorMessage || e.message }); }
});
app.post('/api/admin/refresh', withUser, adminOnly, (req, res) => { invalidateCatalog(); res.json({ ok: true }); });

// Búsqueda manual en TMDB (panel de admin)
app.get('/api/admin/tmdb/search', withUser, adminOnly, async (req, res) => {
    try { res.json({ results: await req.user.service.tmdbSearch(String(req.query.q || '').trim(), req.query.type) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/tmdb/details/:type/:id', withUser, adminOnly, async (req, res) => {
    try { res.json({ info: await req.user.service.tmdbDetails(req.params.type, req.params.id) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===================== MINIATURAS ===================== */
app.get('/api/thumb/:topicId/:msgId', withUser, (req, res) => {
    serveThumb(res, 'g-' + req.params.topicId + '-' + req.params.msgId,
        () => req.user.service.downloadThumb(req.params.topicId, req.params.msgId));
});
app.get('/api/thumb-link/:channel/:msgId', withUser, (req, res) => {
    serveThumb(res, 'l-' + req.params.channel + '-' + req.params.msgId, async () => {
        const svc = req.user.service;
        const message = await svc.getMessageByRef(req.params.channel, req.params.msgId);
        if (!message || !message.media) return null;
        const doc = message.media.document;
        if (message.media.photo) return await svc.client.downloadMedia(message, {});
        if (doc && doc.thumbs && doc.thumbs.length) return await svc.client.downloadMedia(message, { thumb: doc.thumbs.length - 1 });
        return null;
    });
});

/* ===================== STREAMING (por usuario) ===================== */
async function streamMessage(service, message, req, res) {
    if (!message) return res.status(404).end();
    const info = service.docInfo(message);
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
        'Content-Type': info.mimeType, 'Accept-Ranges': 'bytes', 'Content-Length': chunkSize,
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
    });

    const alignedStart = Math.floor(start / ALIGN) * ALIGN;
    let skip = start - alignedStart, toWrite = chunkSize, pos = alignedStart;
    let remaining = Math.ceil((skip + chunkSize) / ALIGN) * ALIGN, attempts = 0;

    while (toWrite > 0 && !res.writableEnded) {
        try {
            const iterator = service.streamRange(info, pos, remaining);
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

app.get('/api/stream/:topicId/:msgId', withUser, async (req, res) => {
    try { await streamMessage(req.user.service, await req.user.service.getMessageById(req.params.msgId), req, res); }
    catch (e) { console.error('stream', e.message); if (!res.headersSent) res.status(500).end(); else res.end(); }
});
app.get('/api/stream-link/:channel/:msgId', withUser, async (req, res) => {
    try { await streamMessage(req.user.service, await req.user.service.getMessageByRef(req.params.channel, req.params.msgId), req, res); }
    catch (e) { console.error('stream-link', e.message); if (!res.headersSent) res.status(500).end(); else res.end(); }
});

/* ===================== FRONTEND ===================== */
app.get('/api/health', (req, res) => {
    const writable = sessions.canWrite();
    const dir = cfg.dataDir;
    const mode = sessions.storeMode();
    const isPersistent = mode === 'postgres' || (!/(^\/tmp\/|tmp[\\/]tvp-data)/i.test(dir) && writable);
    res.json({
        ok: true,
        app: cfg.appName,
        store: mode,
        dataDir: dir,
        writable,
        persistent: isPersistent,
        sessions: sessions.persistedCount(),
        hint: isPersistent
            ? (mode === 'postgres' ? 'OK - sesiones en Postgres (sobreviven a redeploys)' : 'OK - las sesiones persisten entre redeploys')
            : 'Disco temporal. En Koyeb/Render free: define DATABASE_URL (Postgres) para no perder los logins.'
    });
});

app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

(async () => {
    await sessions.init();
    app.listen(cfg.port, () => {
        console.log(`🚀 ${cfg.appName} (multi-usuario) en el puerto ${cfg.port}`);
        console.log('📂 Persistencia =', sessions.storeMode(), '| DATA_DIR =', cfg.dataDir, '| escribible:', sessions.canWrite(), '| sesiones guardadas:', sessions.persistedCount());
        if (sessions.storeMode() === 'file' && !sessions.canWrite()) {
            console.warn('⚠️  Sin Postgres y DATA_DIR NO escribible: los logins se perderán en cada redeploy. Define DATABASE_URL o un disco persistente.');
        }
    });
})();
