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

    // Captura errores que de otro modo se "tragan", para diagnosticar
    window.addEventListener('unhandledrejection', (e) => console.error('[tg] promesa no manejada:', e.reason && (e.reason.stack || e.reason.message || e.reason)));
    window.addEventListener('error', (e) => console.error('[tg] error global:', e.message, e.filename, e.lineno));

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
        if (!window.telegram || !window.telegram.TelegramClient) {
            throw new Error('No se pudo cargar la librería de Telegram. Revisa tu conexión y recarga la página.');
        }
        const { TelegramClient, sessions } = window.telegram;
        return new TelegramClient(new sessions.StringSession(sessionStr || ''), cfg.apiId, cfg.apiHash, {
            connectionRetries: 5, useWSS: true, autoReconnect: true
        });
    }

    function withTimeout(promise, ms, msg) {
        return Promise.race([
            promise,
            new Promise((_, rej) => setTimeout(() => rej(new Error(msg || ('Tiempo de espera agotado (' + ms + 'ms)'))), ms))
        ]);
    }

    // Espera a que GramJS (window.telegram) este cargado
    async function whenReady() {
        try { if (window.__tgReady) await window.__tgReady; } catch (e) { /* fallthrough */ }
        if (!window.telegram || !window.telegram.TelegramClient) {
            throw new Error('No se pudo cargar la librería de Telegram. Revisa tu conexión y recarga la página.');
        }
    }

    async function ensureClient() {
        if (_client) return _client;
        if (_clientPromise) return _clientPromise;
        _clientPromise = (async () => {
            await whenReady();
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
    // Acciones que necesitan File/Blob (no caben en el JSON shim) - API directa.
    window.TVP_ADMIN = {
        // Subir archivo: file=File, peer=string, caption?, replyTo?, onProgress?
        async sendFile(peer, file, caption, replyTo, onProgress) {
            const r = await requireService(); if (r.err) throw new Error('Sin sesión');
            return await r.svc.sendFileTo(peer, file, caption, replyTo, onProgress);
        },
        // Reemplazar el archivo de un mensaje.
        async replaceFile(peer, msgId, file, caption) {
            const r = await requireService(); if (r.err) throw new Error('Sin sesión');
            await r.svc.replaceFileIn(peer, msgId, file, caption);
            return true;
        },
        // Descargar miniatura de un mensaje (devuelve Blob para mostrar).
        async getThumb(peer, msgId) {
            const r = await requireService(); if (r.err) return null;
            const data = await r.svc.downloadAnyThumb(peer, msgId);
            if (!data) return null;
            const u = data instanceof Uint8Array ? data : new Uint8Array(data);
            return new Blob([u], { type: 'image/jpeg' });
        },
        // Descargar avatar (foto de perfil) de un peer.
        async getAvatar(peer) {
            const r = await requireService(); if (r.err) return null;
            try {
                const data = await r.svc.downloadAvatar(peer);
                if (!data) return null;
                const u = data instanceof Uint8Array ? data : new Uint8Array(data);
                return new Blob([u], { type: 'image/jpeg' });
            } catch { return null; }
        }
    };

    // Login con QR: el usuario escanea el codigo desde su app de Telegram movil
    // (Ajustes -> Dispositivos -> Vincular dispositivo) y entra sin SMS ni codigo.
    async function qrLogin(opts) {
        opts = opts || {};
        const onUrl = opts.onUrl || function () { };
        const onStatus = opts.onStatus || function () { };
        const askPassword = opts.askPassword || (() => prompt('Contraseña 2FA:') || '');
        await whenReady();
        if (!_loginClient) {
            _loginClient = newClient('');
            await withTimeout(_loginClient.connect(), 25000, 'No se pudo conectar con Telegram.');
        }
        try {
            await _loginClient.signInUserWithQrCode(
                { apiId: cfg.apiId, apiHash: cfg.apiHash },
                {
                    qrCode: async (code) => {
                        try {
                            const token = code.token.toString('base64')
                                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                            onUrl('tg://login?token=' + token);
                            onStatus('Escanea el código en tu app de Telegram.');
                        } catch (e) { console.warn('[tg-qr] qrCode cb', e); }
                    },
                    password: async () => {
                        onStatus('Pide tu contraseña 2FA…');
                        return await askPassword();
                    },
                    onError: async (err) => {
                        console.warn('[tg-qr] error:', err && err.message);
                        onStatus('Error: ' + (err && err.message));
                        return true; // detener
                    }
                }
            );
        } catch (e) {
            // GramJS 2.26 a veces falla al procesar el ultimo update tras escanear QR
            // ("Missing MTProto Entity: ID ..."). Pero la sesion YA es valida en el cliente.
            const msg = (e && (e.message || e.errorMessage)) || '';
            console.warn('[tg-qr] post-scan exception:', msg);
            let authorized = false;
            try { authorized = await _loginClient.checkAuthorization(); } catch (e2) { }
            if (!authorized) {
                onStatus('No se pudo iniciar sesión: ' + msg);
                throw e;
            }
            console.log('[tg-qr] La sesión SI quedo iniciada pese al error de TL. Continuando.');
        }
        // Sesion iniciada
        saveSession(_loginClient);
        _client = _loginClient;
        _loginClient = null;
        _service = new window.TelegramService(_client, cfg);
        onStatus('¡Conectado! Cargando…');
        try { localStorage.setItem('tvp_token', 'local'); } catch { }
        location.reload();
    }
    window.TVP_QR = { start: qrLogin };

    async function loginStart() {
        await whenReady();
        console.log('[tg] login: creando cliente...');
        try {
            _loginClient = newClient('');
        } catch (e) {
            console.error('[tg] login: ERROR al CREAR el cliente:', e && (e.stack || e.message));
            throw e;
        }
        console.log('[tg] login: cliente creado. Conectando con Telegram (WebSocket)...');
        try {
            await withTimeout(_loginClient.connect(), 25000, 'No se pudo conectar con Telegram (WebSocket).');
        } catch (e) {
            console.error('[tg] login: ERROR al CONECTAR:', e && (e.stack || e.message));
            throw e;
        }
        console.log('[tg] login: CONECTADO.');
        _login = {};
        return json({ loginId: 'local' });
    }
    async function loginSendCode(body) {
        await whenReady();
        const phone = String(body.phone || '').trim();
        if (!phone) return json({ error: 'Escribe tu número con prefijo (ej: +34...).' }, 400);
        if (!_loginClient) { _loginClient = newClient(''); await withTimeout(_loginClient.connect(), 25000, 'No se pudo conectar con Telegram.'); }
        console.log('[tg] login: enviando código a', phone);
        const r = await withTimeout(_loginClient.sendCode({ apiId: cfg.apiId, apiHash: cfg.apiHash }, phone), 25000, 'Telegram no respondió al enviar el código.');
        // Diagnostico: por que medio mando Telegram el codigo
        try {
            const t = r && r.type && r.type.className;
            const next = r && r.nextType && r.nextType.className;
            const len = r && r.type && r.type.length;
            console.log('[tg] login: tipo de envio =', t, '| longitud =', len, '| siguiente medio =', next || '(ninguno)');
            if (/App/i.test(t || '')) console.log('[tg] -> El codigo se envio a la APP de Telegram (chat oficial "Telegram"), NO por SMS.');
            else if (/Sms/i.test(t || '')) console.log('[tg] -> El codigo se envio por SMS al numero', phone);
            else if (/Call/i.test(t || '')) console.log('[tg] -> El codigo se envia por LLAMADA telefonica.');
        } catch (e) { }
        console.log('[tg] login: código enviado, revisa Telegram.');
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
        let inGroup = false, isAdmin = false, name = '', userId = '', username = '';
        try { await svc.resolveGroup(); inGroup = true; } catch {}
        try { isAdmin = await svc.isGroupAdmin(); } catch {}
        try {
            const me = await c.getMe();
            if (me) {
                name = me.firstName || me.username || '';
                userId = String(me.id || '');
                username = (me.username || '').toLowerCase();
            }
        } catch {}
        // ¿Es el propietario de la app? Si esta configurado ownerId/ownerUsername,
        // solo entonces; si esta vacio, devolvemos true para "modo configuracion".
        const ownerId = String(cfg.ownerId || '');
        const ownerUsername = String(cfg.ownerUsername || '').replace(/^@/, '').toLowerCase();
        const ownerConfigured = !!(ownerId || ownerUsername);
        const isOwner = !ownerConfigured ||
            (ownerId && userId === ownerId) ||
            (ownerUsername && username === ownerUsername);
        return json({ loggedIn: true, isAdmin, isOwner, ownerConfigured, name, userId, username, inGroup });
    }

    async function requireService() {
        const svc = await ensureService();
        if (!svc) return { err: json({ needLogin: true }, 401) };
        try { await svc.resolveGroup(); }
        catch (e) {
            // Tolerancia: si el unico problema son constructores TL desconocidos,
            // intentamos seguir adelante asumiendo que SI tenemos acceso (el usuario
            // es admin/dueno). Asi no bloqueamos por culpa de GramJS desactualizada.
            const m = (e && e.message) || '';
            const isTL = /Could not find a matching Constructor|Missing MTProto Entity/i.test(m);
            if (!isTL) {
                return { err: json({ needAccess: true, error: 'Tu cuenta no es miembro del grupo. Pide al administrador que te añada.' }, 403) };
            }
            console.warn('[tg] resolveGroup fallo por TL desconocido, continuando con acceso tolerado:', m);
        }
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
        const fast = u.searchParams.get('fast') === '1'; // carga rapida (300 por tema)
        if (!_catalog || fresh || Date.now() - _catalogTime > 60000) {
            _catalog = await r.svc.getCatalog(fast ? { limit: 300 } : undefined);
            _catalogTime = Date.now();
        }
        return json(_catalog);
    }

    function tmdbHeaders() { return cfg.tmdbToken ? { 'Authorization': 'Bearer ' + cfg.tmdbToken, 'accept': 'application/json' } : { 'accept': 'application/json' }; }
    function tmdbAuthQuery() { return cfg.tmdbToken ? '' : ('&api_key=' + (cfg.tmdbKey || '')); }

    // Decode URI seguro: si la cadena es invalida (caracter % suelto, etc.),
    // devuelve la cadena original en lugar de lanzar 'URI malformed'.
    function safeDecode(s) {
        try { return decodeURIComponent(s); }
        catch (e) { console.warn('[tg] safeDecode fallback para', s); return s; }
    }

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

            // ====== HERRAMIENTAS DE ADMIN GENERICO (gestor de grupos) ======
            // Listar grupos donde el usuario participa (con marca admin/dueno).
            if (rest === 'admin/groups') {
                const r = await requireService(); if (r.err) return r.err;
                return json({ groups: await r.svc.getMisGrupos() });
            }
            // Historial de un grupo concreto: /api/admin/group/:peer/messages?topic=...&limit=...&offsetId=...
            if (parts[0] === 'admin' && parts[1] === 'group' && parts[3] === 'messages') {
                const r = await requireService(); if (r.err) return r.err;
                const peer = safeDecode(parts[2]);
                const limit = Number(u.searchParams.get('limit') || 50);
                const topic = Number(u.searchParams.get('topic') || 0);
                const offsetId = Number(u.searchParams.get('offsetId') || 0);
                return json({ messages: await r.svc.getChatHistory(peer, limit, topic, offsetId) });
            }
            // Enviar texto: { peer, text, replyTo? }
            if (rest === 'admin/send-text' && method === 'POST') {
                const r = await requireService(); if (r.err) return r.err;
                return json({ message: await r.svc.sendTextTo(body.peer, body.text, body.replyTo) });
            }
            // Editar texto: { peer, msgId, text }
            if (rest === 'admin/edit-text' && method === 'POST') {
                const r = await requireService(); if (r.err) return r.err;
                await r.svc.editTextIn(body.peer, body.msgId, body.text);
                return json({ ok: true });
            }
            // Borrar mensajes: { peer, msgIds: [] }
            if (rest === 'admin/delete-msgs' && method === 'POST') {
                const r = await requireService(); if (r.err) return r.err;
                await r.svc.deleteMessagesIn(body.peer, body.msgIds || []);
                return json({ ok: true });
            }
            // Reenviar mensajes: { fromPeer, msgIds: [], toPeer, asCopy, topMsgId? }
            if (rest === 'admin/forward' && method === 'POST') {
                const r = await requireService(); if (r.err) return r.err;
                await r.svc.forwardMessages(body.fromPeer, body.msgIds || [], body.toPeer, !!body.asCopy, body.topMsgId);
                return json({ ok: true });
            }
            // Reenviar al grupo principal de TV+: { fromPeer, msgIds: [], topMsgId?, asCopy? }
            // El destino siempre es cfg.groupId. Por defecto asCopy=true (anonimo).
            if (rest === 'admin/forward-to-mine' && method === 'POST') {
                const r = await requireService(); if (r.err) return r.err;
                const asCopy = body.asCopy === false ? false : true;
                await r.svc.forwardMessages(body.fromPeer, body.msgIds || [], cfg.groupId, asCopy, body.topMsgId);
                _catalog = null; // invalidar cache para que el catalogo recoja lo nuevo
                return json({ ok: true });
            }
            // Lista de temas del grupo principal de TV+ (para el selector de destino)
            if (rest === 'admin/dest-topics') {
                const r = await requireService(); if (r.err) return r.err;
                let topics = [];
                try { topics = await r.svc.getGroupTopics(cfg.groupId); } catch (e) { console.warn('[api] dest-topics:', e.message); }
                return json({ groupId: cfg.groupId, topics });
            }
            // Lista de topicos de un grupo foro: /api/admin/group/:peer/topics
            if (parts[0] === 'admin' && parts[1] === 'group' && parts[3] === 'topics') {
                const r = await requireService(); if (r.err) return r.err;
                const peer = safeDecode(parts[2]);
                return json({ topics: await r.svc.getGroupTopics(peer) });
            }
            // Crear un nuevo topic en un grupo: { peer, title, iconColor? }
            if (rest === 'admin/topic-create' && method === 'POST') {
                const r = await requireService(); if (r.err) return r.err;
                await r.svc.createTopic(body.peer, body.title, body.iconColor);
                return json({ ok: true });
            }
            // Datos de la cuenta logueada (para mostrar Premium/etc.)
            if (rest === 'admin/account') {
                const r = await requireService(); if (r.err) return r.err;
                return json({ account: await r.svc.getMyAccount() });
            }
            // Busqueda global: /api/admin/search?q=...&kind=all|videos|photos|docs|links&limit=30
            if (rest === 'admin/search') {
                const r = await requireService(); if (r.err) return r.err;
                const q = u.searchParams.get('q') || '';
                const kind = u.searchParams.get('kind') || 'all';
                const lim = Number(u.searchParams.get('limit') || 30);
                return json({ results: await r.svc.searchGlobal(q, lim, kind) });
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
        return svc.getMessageByRef(safeDecode(a), b); // tgstreamlink / tgthumblink
    }
    async function swInfo(kind, a, b) {
        const svc = await ensureService(); if (!svc) return null;
        try {
            const msg = await resolveMessage(svc, kind, a, b);
            if (!msg) { console.warn('[sw-bridge] sin mensaje para', kind, a, b); return null; }
            const info = svc.docInfo(msg);
            if (!info) { console.warn('[sw-bridge] sin docInfo (¿no es archivo?) para', kind, a, b); return null; }
            let filename = '';
            try {
                const doc = msg.media && msg.media.document;
                if (doc) {
                    const fn = (doc.attributes || []).find(a => a.className === 'DocumentAttributeFilename');
                    if (fn) filename = fn.fileName || '';
                }
            } catch { }
            console.log('[sw-bridge] info OK', kind, a, b, '→', info.size, info.mimeType, filename);
            return { size: info.size, mime: info.mimeType, filename };
        } catch (e) {
            console.error('[sw-bridge] info ERROR', kind, a, b, e && e.message);
            return null;
        }
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
        else data = await svc.downloadThumbByRef(safeDecode(a), b);
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

    // =========================================================================
    // PUENTE PARA EL REPRODUCTOR NATIVO (ExoPlayer) DE LA APK ANDROID
    // -------------------------------------------------------------------------
    // El servidor local de la app (LocalStreamServer) pide aqui los metadatos y
    // los rangos de bytes del video; nosotros los obtenemos de Telegram con
    // GramJS (la misma logica que alimenta al Service Worker) y se los devolvemos
    // subiendolos por HTTP a 127.0.0.1:<puerto>. Solo se activa dentro de la APK
    // (cuando existe window.NativeHost); en el navegador no hace nada.
    // =========================================================================
    function nativePort() {
        try { return (window.NativeHost && NativeHost.serverPort && NativeHost.serverPort()) || 0; }
        catch (e) { return 0; }
    }
    function parseRef(refJson) {
        try { const o = JSON.parse(refJson); return { kind: o.kind, a: o.a, b: o.b }; }
        catch (e) { return null; }
    }
    window.NativeStream = {
        // Metadatos del fichero -> POST /meta?id=reqId con cabeceras x-size/x-mime
        async meta(refJson, reqId) {
            const port = nativePort(); if (!port) return;
            const r = parseRef(refJson); if (!r) return this._failMeta(port, reqId);
            try {
                const info = await swInfo(r.kind, r.a, r.b);
                await fetch(`http://127.0.0.1:${port}/meta?id=${encodeURIComponent(reqId)}`, {
                    method: 'POST',
                    headers: { 'x-size': String((info && info.size) || 0), 'x-mime': (info && info.mime) || '' }
                });
            } catch (e) { this._failMeta(port, reqId); }
        },
        _failMeta(port, reqId) {
            try { fetch(`http://127.0.0.1:${port}/meta?id=${encodeURIComponent(reqId)}`, { method: 'POST', headers: { 'x-size': '0', 'x-mime': '' } }); } catch (e) {}
        },
        // Rango de bytes -> POST /feed?id=reqId con el cuerpo binario
        async pump(refJson, start, length, reqId) {
            const port = nativePort(); if (!port) return;
            const r = parseRef(refJson); if (!r) return this._failFeed(port, reqId);
            try {
                const u = await swChunk(r.kind, r.a, r.b, Number(start), Number(length));
                const body = u ? (u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)) : new ArrayBuffer(0);
                await fetch(`http://127.0.0.1:${port}/feed?id=${encodeURIComponent(reqId)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body
                });
            } catch (e) { this._failFeed(port, reqId); }
        },
        _failFeed(port, reqId) {
            try { fetch(`http://127.0.0.1:${port}/feed?id=${encodeURIComponent(reqId)}`, { method: 'POST', body: new ArrayBuffer(0) }); } catch (e) {}
        }
    };
})();
