/* ===================================================================
 * Capa cliente (sin servidor):
 *  - Gestiona la sesion de Telegram (login telefono+2FA) en el navegador.
 *  - "Shim" de window.fetch que responde a /api/* usando GramJS, para que
 *    el frontend (script.js) funcione SIN cambios.
 *  - Registra el Service Worker (stream-sw.js) y le sirve los trozos de
 *    video/miniaturas que pida (puente SW <-> pagina).
 * =================================================================== */
(function () {
    'use strict';
    const cfg = window.TVP_CONFIG;
    const SS_KEY = 'tvp_session';

    let _client = null;          // cliente autorizado
    let _clientPromise = null;
    let _service = null;
    let _loginClient = null;     // cliente temporal durante el login
    let _login = {};             // { phone, hash }
    let _catalog = null, _catalogTime = 0;

    function json(data, status) {
        return new Response(JSON.stringify(data || {}), {
            status: status || 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    function newClient(sessionStr) {
        const { TelegramClient, sessions } = window.telegram;
        return new TelegramClient(new sessions.StringSession(sessionStr || ''), cfg.apiId, cfg.apiHash, {
            connectionRetries: 5, useWSS: true, autoReconnect: true
        });
    }

    async function ensureClient() {
        if (_client) return _client;
        if (_clientPromise) return _clientPromise;
        _clientPromise = (async () => {
            let str = '';
            try { str = localStorage.getItem(SS_KEY) || ''; } catch {}
            if (!str) return null;
            const client = newClient(str);
            await client.connect();
            if (!(await client.checkAuthorization())) {
                try { await client.disconnect(); } catch {}
                return null;
            }
            _client = client;
            return client;
        })();
        try { return await _clientPromise; } finally { _clientPromise = null; }
    }

    async function ensureService() {
        if (_service) return _service;
        const c = await ensureClient();
        if (!c) return null;
        _service = new window.TelegramService(c, cfg);
        return _service;
    }

    function saveSession(client) {
        try { localStorage.setItem(SS_KEY, client.session.save()); } catch {}
    }

    /* ---------------- LOGIN ---------------- */
    async function loginStart() {
        _loginClient = newClient('');
        await _loginClient.connect();
        _login = {};
        return json({ loginId: 'local' });
    }
    async function loginSendCode(body) {
        const phone = String(body.phone || '').trim();
        if (!phone) return json({ error: 'Escribe tu número con prefijo (ej: +34...).' }, 400);
        if (!_loginClient) { _loginClient = newClient(''); await _loginClient.connect(); }
        const r = await _loginClient.sendCode({ apiId: cfg.apiId, apiHash: cfg.apiHash }, phone);
        _login = { phone, hash: r.phoneCodeHash };
        return json({ ok: true });
    }
    async function finalizeLogin() {
        saveSession(_loginClient);
        _client = _loginClient;
        _loginClient = null;
        _service = new window.TelegramService(_client, cfg);
        let isAdmin = false, name = '';
        try { await _service.resolveGroup(); } catch {}
        try { isAdmin = await _service.isGroupAdmin(); } catch {}
        try { const me = await _client.getMe(); name = (me && (me.firstName || me.username)) || ''; } catch {}
        return json({ ok: true, isAdmin, name, token: 'local' });
    }
    async function loginSignIn(body) {
        const Api = window.telegram.Api;
        try {
            await _loginClient.invoke(new Api.auth.SignIn({
                phoneNumber: _login.phone, phoneCodeHash: _login.hash,
                phoneCode: String(body.code || '').replace(/\s+/g, '')
            }));
        } catch (e) {
            if ((e.errorMessage || e.message || '').includes('SESSION_PASSWORD_NEEDED')) return json({ needPassword: true });
            return json({ error: e.errorMessage || e.message }, 500);
        }
        return finalizeLogin();
    }
    async function loginPassword(body) {
        let used = false;
        try {
            await _loginClient.signInWithPassword(
                { apiId: cfg.apiId, apiHash: cfg.apiHash },
                {
                    password: async () => { if (used) throw new Error('Contraseña 2FA incorrecta.'); used = true; return String(body.password || ''); },
                    onError: (e) => { throw e; }
                }
            );
        } catch (e) { return json({ error: e.errorMessage || e.message }, 500); }
        return finalizeLogin();
    }

    /* ---------------- API HANDLERS ---------------- */
    async function handleMe() {
        const c = await ensureClient();
        if (!c) return json({ loggedIn: false });
        const svc = await ensureService();
        let inGroup = false, isAdmin = false, name = '';
        try { await svc.resolveGroup(); inGroup = true; } catch {}
        try { isAdmin = await svc.isGroupAdmin(); } catch {}
        try { const me = await c.getMe(); name = (me && (me.firstName || me.username)) || ''; } catch {}
        return json({ loggedIn: true, isAdmin, name, inGroup });
    }

    async function requireService() {
        const svc = await ensureService();
        if (!svc) return { err: json({ needLogin: true }, 401) };
        try { await svc.resolveGroup(); }
        catch { return { err: json({ needAccess: true, error: 'Tu cuenta no es miembro del grupo. Pide al administrador que te añada.' }, 403) }; }
        return { svc };
    }
    async function requireAdmin() {
        const r = await requireService();
        if (r.err) return r;
        let isAdmin = false;
        try { isAdmin = await r.svc.isGroupAdmin(); } catch {}
        if (!isAdmin) return { err: json({ error: 'Solo para administradores del grupo.' }, 403) };
        return r;
    }

    async function handleCatalog(u) {
        const r = await requireService();
        if (r.err) return r.err;
        const fresh = u.searchParams.get('refresh') === '1';
        if (!_catalog || fresh || Date.now() - _catalogTime > 60000) {
            _catalog = await r.svc.getCatalog();
            _catalogTime = Date.now();
        }
        return json(_catalog);
    }

    function tmdbHeaders() { return cfg.tmdbToken ? { 'Authorization': 'Bearer ' + cfg.tmdbToken, 'accept': 'application/json' } : { 'accept': 'application/json' }; }
    function tmdbAuthQuery() { return cfg.tmdbToken ? '' : ('&api_key=' + (cfg.tmdbKey || '')); }

    async function handleApi(pathname, init, fullUrl) {
        const u = new URL(fullUrl, location.href);
        const rest = pathname.replace(/^.*\/api\//, '');
        const method = (init && init.method ? init.method : 'GET').toUpperCase();
        let body = {};
        try { if (init && init.body) body = JSON.parse(init.body); } catch {}
        const parts = rest.split('/');

        try {
            // Publicos
            if (rest === 'app') return json({ appName: cfg.appName });
            if (rest === 'me') return handleMe();

            // Login
            if (rest === 'login/start') return loginStart();
            if (rest === 'login/send-code') return loginSendCode(body);
            if (rest === 'login/sign-in') return loginSignIn(body);
            if (rest === 'login/password') return loginPassword(body);
            if (rest === 'logout') {
                try { const c = await ensureClient(); if (c) { try { await c.invoke(new window.telegram.Api.auth.LogOut()); } catch {} await c.disconnect(); } } catch {}
                try { localStorage.removeItem(SS_KEY); } catch {}
                _client = null; _service = null;
                return json({ ok: true });
            }

            // Catalogo
            if (rest === 'catalog') return handleCatalog(u);

            // TMDB publicos (requieren sesion)
            if (parts[0] === 'tmdb' && parts[1] === 'recommendations') {
                const r = await requireService(); if (r.err) return r.err;
                const t = parts[2] === 'tv' ? 'tv' : 'movie';
                const url = `https://api.themoviedb.org/3/${t}/${parts[3]}/recommendations?language=es-ES` + tmdbAuthQuery();
                const rr = await fetch(url, { headers: tmdbHeaders() }); const d = await rr.json();
                return json({ results: (d.results || []).slice(0, 12).map(x => ({
                    id: x.id, type: t, title: x.title || x.name,
                    year: ((x.release_date || x.first_air_date || '').match(/^(\d{4})/) || [])[1] || '',
                    poster: x.poster_path ? 'https://image.tmdb.org/t/p/w500' + x.poster_path : '',
                    rating: x.vote_average ? Math.round(x.vote_average * 10) / 10 : ''
                })) });
            }
            if (rest === 'tmdb/upcoming') {
                const r = await requireService(); if (r.err) return r.err;
                const url = `https://api.themoviedb.org/3/movie/upcoming?language=es-ES&region=ES&page=1` + tmdbAuthQuery();
                const rr = await fetch(url, { headers: tmdbHeaders() }); const d = await rr.json();
                return json({ results: (d.results || []).slice(0, 14).map(x => ({
                    id: 'up-' + x.id, type: 'movie', title: x.title,
                    year: ((x.release_date || '').match(/^(\d{4})/) || [])[1] || '',
                    date: x.release_date || '',
                    poster: x.poster_path ? 'https://image.tmdb.org/t/p/w500' + x.poster_path : '',
                    backdrop: x.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + x.backdrop_path : '',
                    description: x.overview || '',
                    rating: x.vote_average ? Math.round(x.vote_average * 10) / 10 : ''
                })) });
            }

            // Admin
            if (rest === 'topics') {
                const r = await requireAdmin(); if (r.err) return r.err;
                const topics = await r.svc.getAutoTopics();
                return json({ topics: topics.map(t => ({ id: t.id, title: t.name, icon: t.icon })) });
            }
            if (parts[0] === 'chat') {
                const r = await requireAdmin(); if (r.err) return r.err;
                const topicId = parts[1];
                const msgs = await r.svc.getTopicMessages(topicId, 60);
                const out = msgs.map(m => {
                    const doc = m.media && m.media.document;
                    const isVideo = !!(doc && /video/.test(doc.mimeType || ''));
                    const hasThumb = !!(m.media && (m.media.photo || (doc && doc.thumbs && doc.thumbs.length)));
                    return {
                        id: m.id, text: m.message || '', date: m.date, hasMedia: !!m.media, isVideo,
                        thumbUrl: hasThumb ? `tgthumb/${topicId}/${m.id}` : '',
                        streamUrl: isVideo ? `tgstream/${topicId}/${m.id}` : ''
                    };
                });
                return json({ messages: out });
            }
            if (rest === 'admin/edit') {
                const r = await requireAdmin(); if (r.err) return r.err;
                await r.svc.editMessageText(body.msgId, body.text || ''); _catalog = null;
                return json({ ok: true });
            }
            if (rest === 'admin/delete') {
                const r = await requireAdmin(); if (r.err) return r.err;
                await r.svc.deleteMessage(body.msgId); _catalog = null;
                return json({ ok: true });
            }
            if (rest === 'admin/refresh') {
                const r = await requireAdmin(); if (r.err) return r.err;
                _catalog = null; return json({ ok: true });
            }
            if (rest === 'admin/tmdb/search') {
                const r = await requireAdmin(); if (r.err) return r.err;
                return json({ results: await r.svc.tmdbSearch(String(u.searchParams.get('q') || '').trim(), u.searchParams.get('type')) });
            }
            if (parts[0] === 'admin' && parts[1] === 'tmdb' && parts[2] === 'details') {
                const r = await requireAdmin(); if (r.err) return r.err;
                return json({ info: await r.svc.tmdbDetails(parts[3], parts[4]) });
            }

            return json({ error: 'Ruta no encontrada: ' + rest }, 404);
        } catch (e) {
            console.error('[api]', rest, e);
            return json({ error: e.errorMessage || e.message || 'Error interno' }, 500);
        }
    }

    /* ---------------- FETCH SHIM ---------------- */
    const origFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = function (input, init) {
        try {
            const url = (typeof input === 'string') ? input : (input && input.url) || '';
            const pathname = new URL(url, location.href).pathname;
            if (/\/api\//.test(pathname)) return handleApi(pathname, init || (typeof input === 'object' ? input : {}), url);
        } catch {}
        return origFetch ? origFetch(input, init) : Promise.reject(new Error('fetch no disponible'));
    };

    /* ---------------- PUENTE SERVICE WORKER (streaming/miniaturas) ---------------- */
    const ALIGN = 4096;
    function concatChunks(parts, total) {
        const out = new Uint8Array(total);
        let off = 0;
        for (const p of parts) { out.set(p, off); off += p.length; }
        return out;
    }
    async function resolveMessage(svc, kind, a, b) {
        if (kind === 'tgstream' || kind === 'tgthumb') return svc.getMessageById(b);
        return svc.getMessageByRef(decodeURIComponent(a), b); // tgstreamlink / tgthumblink
    }
    async function swInfo(kind, a, b) {
        const svc = await ensureService(); if (!svc) return null;
        const msg = await resolveMessage(svc, kind, a, b);
        if (!msg) return null;
        const info = svc.docInfo(msg);
        if (!info) return null;
        return { size: info.size, mime: info.mimeType };
    }
    async function swChunk(kind, a, b, start, length) {
        const svc = await ensureService(); if (!svc) return null;
        const msg = await resolveMessage(svc, kind, a, b);
        const info = svc.docInfo(msg); if (!info) return null;
        const alignedStart = Math.floor(start / ALIGN) * ALIGN;
        const need = (start - alignedStart) + length;
        const limit = Math.ceil(need / ALIGN) * ALIGN;
        const parts = []; let got = 0;
        for await (const chunk of svc.streamRange(info, alignedStart, limit)) {
            const u = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            parts.push(u); got += u.length;
            if (got >= need) break;
        }
        const full = concatChunks(parts, got);
        const slice = full.subarray(start - alignedStart, start - alignedStart + length);
        return new Uint8Array(slice); // copia con buffer propio
    }
    async function swThumb(kind, a, b) {
        const svc = await ensureService(); if (!svc) return null;
        let data;
        if (kind === 'tgthumb') data = await svc.downloadThumb(null, b);
        else data = await svc.downloadThumbByRef(decodeURIComponent(a), b);
        if (!data) return null;
        return data instanceof Uint8Array ? data : new Uint8Array(data);
    }

    async function onSwMessage(ev) {
        const msg = ev.data || {};
        const port = ev.ports && ev.ports[0];
        if (!port || !msg.op) return;
        try {
            if (msg.op === 'info') { port.postMessage(await swInfo(msg.kind, msg.a, msg.b)); return; }
            if (msg.op === 'thumb') {
                const u = await swThumb(msg.kind, msg.a, msg.b);
                if (!u) return port.postMessage(null);
                const buf = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
                port.postMessage(buf, [buf]); return;
            }
            if (msg.op === 'chunk') {
                const u = await swChunk(msg.kind, msg.a, msg.b, msg.start, msg.length);
                if (!u) return port.postMessage(null);
                const buf = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
                port.postMessage(buf, [buf]); return;
            }
        } catch (e) {
            console.warn('[sw-bridge]', msg.op, e.message);
            try { port.postMessage(null); } catch {}
        }
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', onSwMessage);
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('stream-sw.js').catch(e => console.warn('SW register:', e.message));
        });
    }
})();
