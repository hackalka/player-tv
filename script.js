/* =====================================================================
 * Player TV — Cliente Telegram con doble vista
 *   • Vista NETFLIX  -> temas de cine/series/deportes (config.netflixTopics)
 *   • Vista TELEGRAM -> el resto de temas "off topic" como un chat normal
 * ===================================================================== */

// ===== HELPERS =====
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

const PLACEHOLDER_COLORS = ['#3a1c71', '#b21f1f', '#1a2a6c', '#4b6cb7', '#182848', '#0f2027', '#572d2d', '#2c3e50'];
function placeholderImage(seed, label) {
    const color = PLACEHOLDER_COLORS[Math.abs(hashCode(String(seed))) % PLACEHOLDER_COLORS.length];
    const txt = (label || 'TV').slice(0, 14);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='600'>
        <rect width='100%' height='100%' fill='${color}'/>
        <text x='50%' y='50%' fill='rgba(255,255,255,.85)' font-family='Arial' font-size='28'
              font-weight='bold' text-anchor='middle' dominant-baseline='middle'>${escapeXml(txt)}</text>
    </svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function hashCode(str) { let h = 0; for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return h; }
function escapeXml(s) { return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])); }
function escapeHtml(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
function concatUint8(arrays) {
    const total = arrays.reduce((n, a) => n + a.byteLength, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) { out.set(a instanceof Uint8Array ? a : new Uint8Array(a), off); off += a.byteLength; }
    return out;
}
function fmtTime(date) {
    try { return new Date(date * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
}
function fmtBytes(n) {
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0; let v = Number(n);
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
}

// ===== ESTADO GLOBAL =====
const state = {
    engine: null,
    topics: [],            // todos los temas del foro
    netflixData: {},       // { categoryName: [items...] }
    allMediaItems: [],     // para la búsqueda
    chatCache: {},         // { topicId: [messages...] }
    currentView: 'netflix' // 'netflix' | 'telegram'
};

// ===== DOM =====
const el = {
    body: document.body,
    netflixView: $('#netflix-view'),
    telegramView: $('#telegram-view'),
    navbar: $('.navbar'),
    navNetflix: $('#nav-netflix'),
    navTelegram: $('#nav-telegram'),
    // netflix
    hero: $('#hero'),
    heroImage: $('#hero-image'),
    heroTitle: $('#hero-title'),
    heroDescription: $('#hero-description'),
    heroBadge: $('#hero-badge'),
    heroPlay: $('#hero-play'),
    heroInfo: $('#hero-info'),
    rowsContainer: $('#rows-container'),
    navLinks: $('#nav-links'),
    // player
    playerModal: $('#player-modal'),
    playerIframe: $('#player-iframe'),
    playerVideo: $('#player-video'),
    playerStatus: $('#player-status'),
    modalTitle: $('#modal-title'),
    modalDescription: $('#modal-description'),
    modalYear: $('#modal-year'),
    modalDuration: $('#modal-duration'),
    // search
    searchBtn: $('.search-btn'),
    searchOverlay: $('#search-overlay'),
    searchInput: $('#search-input'),
    searchResults: $('#search-results'),
    // telegram view
    chatList: $('#chat-list'),
    chatMessages: $('#chat-messages'),
    chatHeaderTitle: $('#chat-header-title'),
    chatHeaderMeta: $('#chat-header-meta'),
    // misc
    loadingScreen: $('#loading-screen'),
    loadingText: $('#loading-text'),
    loginModal: $('#login-modal'),
    qrCode: $('#qr-code'),
    qrLoading: $('#qr-loading'),
    bootStatus: $('#boot-status')
};

function setBoot(msg) { if (el.bootStatus) el.bootStatus.innerText = msg; if (el.loadingText) el.loadingText.innerText = msg; console.log('[boot]', msg); }

// ===== STREAMING (Service Worker bridge) =====
const Streamer = {
    swReady: false,
    port: null,
    registry: new Map(), // streamId -> message

    async register() {
        if (!('serviceWorker' in navigator)) return false;
        try {
            const reg = await navigator.serviceWorker.register('sw.js');
            await navigator.serviceWorker.ready;
            const channel = new MessageChannel();
            this.port = channel.port1;
            this.port.onmessage = (ev) => this._onRequest(ev.data);
            const active = reg.active || navigator.serviceWorker.controller;
            // esperar a que haya SW activo controlando
            const target = navigator.serviceWorker.controller || reg.active;
            if (target) {
                target.postMessage({ type: 'INIT' }, [channel.port2]);
                this.swReady = true;
            } else {
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    navigator.serviceWorker.controller?.postMessage({ type: 'INIT' }, [channel.port2]);
                    this.swReady = true;
                });
            }
            console.log('✅ Service Worker listo para streaming');
            return true;
        } catch (e) {
            console.warn('No se pudo registrar el Service Worker:', e);
            return false;
        }
    },

    // El SW pide un rango -> lo descargamos de Telegram y se lo devolvemos
    async _onRequest(data) {
        if (!data || data.type !== 'FETCH_RANGE') return;
        const { requestId, streamId, start, size } = data;
        try {
            const chunk = await state.engine.downloadRange(this.registry.get(streamId), start, size);
            const buf = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
            this.port.postMessage({ requestId, chunk: buf }, [buf]);
        } catch (err) {
            console.error('Error en rango:', err);
            this.port.postMessage({ requestId, error: err.message || 'fetch error' });
        }
    },

    createStream(message) {
        const doc = message.media && message.media.document;
        if (!doc) return null;
        const streamId = 'tg-' + message.id + '-' + Date.now();
        const fileSize = Number(doc.size);
        const mimeType = doc.mimeType || 'video/mp4';
        this.registry.set(streamId, message);
        const controller = navigator.serviceWorker.controller;
        if (controller) controller.postMessage({ type: 'REGISTER', streamId, fileSize, mimeType });
        // Ruta que intercepta el Service Worker
        return new URL('tg-stream/' + streamId, location.href).pathname;
    }
};

// ===== MOTOR TELEGRAM =====
class TelegramEngine {
    constructor(config) {
        this.cfg = config;
        this.client = null;
        this.entity = null;
    }

    async waitForLib() {
        const inject = (src) => new Promise(res => {
            const s = document.createElement('script');
            s.src = src; s.onload = () => res(true); s.onerror = () => res(false);
            document.head.appendChild(s);
        });
        const ok = () => !!(window.telegram && window.telegram.TelegramClient);
        let n = 0;
        while (!ok() && n < 20) { await new Promise(r => setTimeout(r, 400)); n++; }
        if (!ok()) {
            setBoot('Reintentando cargar Telegram desde un CDN alternativo...');
            await inject('https://unpkg.com/telegram/browser/telegram.js');
            n = 0;
            while (!ok() && n < 25) { await new Promise(r => setTimeout(r, 400)); n++; }
        }
        return ok();
    }

    async init() {
        if (!await this.waitForLib()) {
            setBoot('No se pudo cargar la librería de Telegram. Revisa tu conexión y recarga.');
            this._hideLoading();
            return false;
        }
        const { TelegramClient, sessions } = window.telegram;
        this.Api = window.telegram.Api;
        const sessionStr = SafeStorage.getItem('tg_session') || '';
        const session = new sessions.StringSession(sessionStr);
        this.client = new TelegramClient(session, this.cfg.apiId, this.cfg.apiHash, {
            connectionRetries: 3, useWSS: true, timeout: 15
        });
        setBoot('Conectando con Telegram...');
        try {
            await Promise.race([
                this.client.connect(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('Tiempo de conexión agotado')), 20000))
            ]);
        } catch (e) {
            setBoot('Error conectando: ' + e.message + '. Mostrando login...');
        }
        let authorized = false;
        try { authorized = await this.client.checkAuthorization(); } catch {}
        if (!authorized) {
            this._hideLoading();
            this.showLogin();
            return false;
        }
        SafeStorage.setItem('tg_session', this.client.session.save());
        if (el.loginModal) el.loginModal.hidden = true;
        return true;
    }

    _hideLoading() { if (el.loadingScreen) el.loadingScreen.classList.add('hidden'); }

    _saveAndReload() {
        try { SafeStorage.setItem('tg_session', this.client.session.save()); } catch {}
        setBoot('¡Sesión iniciada! Cargando contenido...');
        setTimeout(() => location.reload(), 600);
    }

    // ---- LOGIN: muestra el modal y conecta los flujos ----
    showLogin() {
        if (!el.loginModal) return;
        el.loginModal.hidden = false;
        setBoot('Inicia sesión para ver tu contenido.');
        LoginUI.setup(this);
    }

    // ---- LOGIN por TELÉFONO ----
    async sendCode(phone) {
        const res = await this.client.sendCode(
            { apiId: this.cfg.apiId, apiHash: this.cfg.apiHash },
            phone
        );
        this._phone = phone;
        this._phoneCodeHash = res.phoneCodeHash;
        return res;
    }

    // Devuelve { ok } o { needPassword: true }
    async signInWithCode(code) {
        const Api = this.Api;
        try {
            await this.client.invoke(new Api.auth.SignIn({
                phoneNumber: this._phone,
                phoneCodeHash: this._phoneCodeHash,
                phoneCode: String(code).replace(/\s+/g, '')
            }));
            return { ok: true };
        } catch (e) {
            const msg = e.errorMessage || e.message || '';
            if (msg.includes('SESSION_PASSWORD_NEEDED')) return { needPassword: true };
            throw e;
        }
    }

    async signInWithPassword(password) {
        let used = false;
        await this.client.signInWithPassword(
            { apiId: this.cfg.apiId, apiHash: this.cfg.apiHash },
            {
                password: async () => {
                    if (used) throw new Error('La contraseña 2FA no es correcta.');
                    used = true; return password;
                },
                onError: (e) => { throw e; }
            }
        );
    }

    // ---- LOGIN por QR ----
    async startQrLogin() {
        try {
            await this.client.signInUserWithQrCode(
                { apiId: this.cfg.apiId, apiHash: this.cfg.apiHash },
                {
                    qrCode: async (code) => {
                        const token = code.token.toString('base64')
                            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                        const url = `tg://login?token=${token}`;
                        if (window.qrcode && el.qrCode) {
                            const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
                            if (el.qrLoading) el.qrLoading.style.display = 'none';
                            el.qrCode.innerHTML = qr.createSvgTag({ cellSize: 4 });
                        }
                    },
                    password: async () => { throw new Error('Esta cuenta tiene 2FA: usa el login por teléfono.'); },
                    onError: (e) => { console.error('QR error', e); setBoot('QR: ' + (e.message || e)); return true; }
                }
            );
            this._saveAndReload();
        } catch (e) {
            console.error('QR Error:', e);
            setBoot('Error de QR: ' + (e.message || e));
        }
    }

    async resolveGroup() {
        if (this.entity) return this.entity;
        try {
            this.entity = await this.client.getEntity(this.cfg.groupId);
        } catch (e) {
            // poblar la caché de entidades con los diálogos y reintentar
            setBoot('Localizando el grupo...');
            await this.client.getDialogs({ limit: 200 });
            this.entity = await this.client.getEntity(this.cfg.groupId);
        }
        return this.entity;
    }

    // Lista de temas del foro
    async fetchTopics() {
        const Api = this.Api;
        const entity = await this.resolveGroup();
        try {
            const res = await this.client.invoke(new Api.channels.GetForumTopics({
                channel: entity, limit: 100, offsetDate: 0, offsetId: 0, offsetTopic: 0
            }));
            return (res.topics || [])
                .filter(t => t.className === 'ForumTopic' || t.id !== undefined)
                .map(t => ({ id: t.id, title: t.title || ('Tema ' + t.id), top: !!t.pinned }));
        } catch (e) {
            console.warn('El grupo no parece un foro o falló GetForumTopics:', e.message);
            return [];
        }
    }

    // Mensajes de un tema concreto (thread)
    async fetchTopicMessages(topicId, limit) {
        const entity = await this.resolveGroup();
        try {
            const opts = { limit: limit || 60 };
            if (topicId && topicId !== 1) opts.replyTo = topicId;
            return await this.client.getMessages(entity, opts);
        } catch (e) {
            console.warn('Error trayendo mensajes del tema', topicId, e.message);
            return [];
        }
    }

    // ---- parsing de items multimedia (vista Netflix) ----
    parseMediaItem(message, category) {
        const text = message.message || '';
        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        const title = (lines[0] || category.name).replace(/#[\wÀ-ÿ]+/g, '').replace(/https?:\/\/\S+/g, '').trim() || 'Sin título';
        const description = lines.slice(1).join(' ').replace(/https?:\/\/\S+/g, '').replace(/#[\wÀ-ÿ]+/g, '').trim();
        const year = (text.match(/\b(19|20)\d{2}\b/) || [])[0] || '';
        const urlMatch = text.match(/https?:\/\/\S+/);
        const externalUrl = urlMatch ? urlMatch[0] : '';
        const doc = message.media && message.media.document;
        const isVideo = !!(doc && /video|mp4|matroska|x-msvideo/.test(doc.mimeType || ''));
        const duration = isVideo ? this._docDuration(doc) : '';
        const size = doc ? fmtBytes(doc.size) : '';
        return {
            id: message.id, message, title, description, year,
            category: category.name, type: category.type,
            externalUrl, isVideo, duration, size,
            thumbnail: null // se descarga en lazy
        };
    }

    _docDuration(doc) {
        const attr = (doc.attributes || []).find(a => a.className === 'DocumentAttributeVideo');
        if (!attr || !attr.duration) return '';
        const total = Number(attr.duration);
        const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60);
        return h ? `${h}h ${m}m` : `${m} min`;
    }

    // Descarga de miniatura/poster (lazy)
    async downloadThumb(message) {
        if (!this.cfg.downloadThumbnails) return null;
        try {
            const media = message.media;
            if (!media) return null;
            let buf;
            if (media.photo) {
                buf = await this.client.downloadMedia(message, {});
            } else if (media.document && media.document.thumbs && media.document.thumbs.length) {
                buf = await this.client.downloadMedia(message, { thumb: media.document.thumbs.length - 1 });
            } else return null;
            if (!buf) return null;
            const blob = new Blob([buf]);
            return URL.createObjectURL(blob);
        } catch (e) {
            console.warn('thumb fail', e.message);
            return null;
        }
    }

    // Descarga de un rango de bytes (para streaming por Service Worker)
    async downloadRange(message, start, size) {
        if (!message) throw new Error('mensaje no encontrado');
        const Api = this.Api;
        const doc = message.media.document;
        const ALIGN = 4096;
        const padLeft = start % ALIGN;
        const reqOffset = start - padLeft;
        let reqLimit = Math.ceil((size + padLeft) / ALIGN) * ALIGN;
        const location = new Api.InputDocumentFileLocation({
            id: doc.id, accessHash: doc.accessHash, fileReference: doc.fileReference, thumbSize: ''
        });
        const BIG = window.bigInt;
        const chunks = [];
        const iter = this.client.iterDownload({
            file: location,
            offset: BIG ? BIG(reqOffset) : reqOffset,
            limit: reqLimit,
            requestSize: 512 * 1024,
            dcId: doc.dcId
        });
        for await (const c of iter) chunks.push(c instanceof Uint8Array ? c : new Uint8Array(c));
        const merged = concatUint8(chunks);
        return merged.slice(padLeft, padLeft + size);
    }

    // Descarga completa a Blob (fallback de reproducción)
    async downloadFull(message, onProgress) {
        const buf = await this.client.downloadMedia(message, {
            progressCallback: (downloaded, total) => {
                try { onProgress && onProgress(Number(downloaded), Number(total)); } catch {}
            }
        });
        const doc = message.media.document;
        return URL.createObjectURL(new Blob([buf], { type: (doc && doc.mimeType) || 'video/mp4' }));
    }
}

/* =====================================================================
 *  VISTA NETFLIX
 * ===================================================================== */
const Netflix = {
    thumbObserver: null,

    init() {
        this.thumbObserver = new IntersectionObserver((entries, obs) => {
            entries.forEach(async (e) => {
                if (!e.isIntersecting) return;
                const card = e.target;
                obs.unobserve(card);
                const item = card._item;
                if (item && !item.thumbnail) {
                    const url = await state.engine.downloadThumb(item.message);
                    if (url) { item.thumbnail = url; const img = card.querySelector('.card-image'); if (img) img.src = url; }
                }
            });
        }, { rootMargin: '200px' });
    },

    render() {
        el.rowsContainer.innerHTML = '';
        const cats = state.engine.cfg.netflixTopics;
        // Links del navbar
        el.navLinks.innerHTML = '<li><a href="#" class="active" data-cat="">Inicio</a></li>' +
            cats.map(c => `<li><a href="#" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)}</a></li>`).join('');

        let heroPool = [];
        cats.forEach(cat => {
            const items = state.netflixData[cat.name] || [];
            if (!items.length) return;
            heroPool = heroPool.concat(items.slice(0, 5));
            el.rowsContainer.appendChild(this.createRow(`${cat.icon} ${cat.name}`, items));
        });

        if (!heroPool.length) {
            el.rowsContainer.innerHTML = `<div class="empty-state">No se encontró contenido en los temas configurados.<br>
                Revisa que el grupo tenga los temas Películas, Series y Deportes con publicaciones.</div>`;
            return;
        }
        this.updateHero(heroPool[0]);
        this.startHeroRotation(heroPool);
    },

    createRow(title, items) {
        const row = document.createElement('section');
        row.className = 'content-row';
        row.innerHTML = `
            <div class="row-header"><h2 class="row-title">${escapeHtml(title)}</h2></div>
            <div class="row-slider">
                <button class="slider-arrow prev" aria-label="Izquierda"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg></button>
                <div class="slider-track"></div>
                <button class="slider-arrow next" aria-label="Derecha"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg></button>
            </div>`;
        const track = $('.slider-track', row);
        items.forEach(it => track.appendChild(this.createCard(it)));
        $('.prev', row).onclick = () => track.scrollBy({ left: -800, behavior: 'smooth' });
        $('.next', row).onclick = () => track.scrollBy({ left: 800, behavior: 'smooth' });
        return row;
    },

    createCard(item) {
        const card = document.createElement('div');
        card.className = 'card';
        card._item = item;
        const initial = item.thumbnail || placeholderImage(item.id, item.title);
        card.innerHTML = `
            <img class="card-image" src="${initial}" alt="${escapeHtml(item.title)}" loading="lazy">
            <div class="card-overlay">
                <h3 class="card-title">${escapeHtml(item.title)}</h3>
                <div class="card-meta">
                    ${item.year ? `<span>${escapeHtml(item.year)}</span>` : ''}
                    ${item.duration ? `<span>${escapeHtml(item.duration)}</span>` : ''}
                    ${item.isVideo ? '<span class="badge-hd">HD</span>' : ''}
                </div>
            </div>
            <div class="card-actions">
                <button class="card-action-btn primary play-btn" title="Reproducir"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></button>
                <button class="card-action-btn info-btn" title="Más info"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg></button>
            </div>`;
        $('.play-btn', card).onclick = (e) => { e.stopPropagation(); Player.open(item); };
        card.onclick = () => Player.open(item);
        this.thumbObserver.observe(card);
        return card;
    },

    updateHero(item) {
        if (!item) return;
        el.heroImage.src = item.thumbnail || placeholderImage(item.id, item.title);
        if (!item.thumbnail) {
            state.engine.downloadThumb(item.message).then(u => { if (u) { item.thumbnail = u; el.heroImage.src = u; } });
        }
        el.heroTitle.innerText = item.title;
        el.heroDescription.innerText = item.description || '';
        el.heroBadge.innerText = item.category;
        el.heroPlay.onclick = () => Player.open(item);
        el.heroInfo.onclick = () => Player.open(item);
    },

    startHeroRotation(items) {
        if (this._heroTimer) clearInterval(this._heroTimer);
        if (!state.engine.cfg.heroAutoRotate || items.length < 2) return;
        let i = 0;
        this._heroTimer = setInterval(() => { i = (i + 1) % items.length; this.updateHero(items[i]); },
            state.engine.cfg.heroRotateInterval || 10000);
    }
};

/* =====================================================================
 *  REPRODUCTOR
 * ===================================================================== */
const Player = {
    async open(item) {
        el.modalTitle.innerText = item.title;
        el.modalDescription.innerText = item.description || 'Sin descripción.';
        el.modalYear.innerText = item.year || '';
        el.modalDuration.innerText = item.duration || item.size || '';
        el.playerModal.hidden = false;
        el.body.style.overflow = 'hidden';
        el.playerStatus.innerText = '';
        el.playerStatus.hidden = true;

        // 1) Video nativo de Telegram -> streaming por Service Worker
        if (item.isVideo) {
            el.playerIframe.hidden = true; el.playerIframe.src = '';
            el.playerVideo.hidden = false;
            await this.playTelegramVideo(item);
            return;
        }
        // 2) Link externo -> iframe
        if (item.externalUrl) {
            el.playerVideo.hidden = true; el.playerVideo.removeAttribute('src'); el.playerVideo.load();
            el.playerIframe.hidden = false;
            el.playerIframe.src = this.toEmbed(item.externalUrl);
            return;
        }
        el.playerVideo.hidden = true; el.playerIframe.hidden = true;
        el.playerStatus.hidden = false;
        el.playerStatus.innerText = 'Esta publicación no tiene video ni enlace reproducible.';
    },

    async playTelegramVideo(item) {
        const video = el.playerVideo;
        try {
            if (Streamer.swReady && navigator.serviceWorker.controller) {
                const src = Streamer.createStream(item.message);
                if (src) {
                    video.src = src;
                    video.onerror = () => this.fallbackFullDownload(item);
                    video.play().catch(() => {});
                    return;
                }
            }
            // sin SW -> descarga completa
            await this.fallbackFullDownload(item);
        } catch (e) {
            console.error(e);
            await this.fallbackFullDownload(item);
        }
    },

    async fallbackFullDownload(item) {
        const video = el.playerVideo;
        el.playerStatus.hidden = false;
        el.playerStatus.innerText = 'Preparando video (descarga directa)...';
        try {
            const url = await state.engine.downloadFull(item.message, (d, t) => {
                if (t) el.playerStatus.innerText = `Cargando ${Math.round(d / t * 100)}%`;
            });
            video.onerror = null;
            video.src = url;
            el.playerStatus.hidden = true;
            video.play().catch(() => {});
        } catch (e) {
            el.playerStatus.innerText = 'No se pudo reproducir el video: ' + e.message;
        }
    },

    toEmbed(url) {
        try {
            const u = new URL(url);
            const yt = u.hostname.includes('youtu');
            if (yt) {
                const id = u.searchParams.get('v') || u.pathname.split('/').pop();
                return `https://www.youtube.com/embed/${id}`;
            }
        } catch {}
        return url;
    },

    close() {
        el.playerModal.hidden = true;
        el.body.style.overflow = '';
        el.playerIframe.src = '';
        try { el.playerVideo.pause(); } catch {}
        el.playerVideo.removeAttribute('src'); el.playerVideo.load();
    }
};

/* =====================================================================
 *  VISTA TELEGRAM (off topic)
 * ===================================================================== */
const Telegram = {
    activeTopicId: null,

    renderChatList() {
        const netflixIds = new Set(state.engine.cfg.netflixTopics.map(t => t.id));
        const netflixNames = {};
        state.engine.cfg.netflixTopics.forEach(t => netflixNames[t.id] = t);
        el.chatList.innerHTML = '';

        // aseguramos un "General" si el foro lo tiene (id 1)
        const list = state.topics.slice();
        if (!list.some(t => t.id === 1)) list.unshift({ id: 1, title: 'General' });

        list.forEach(topic => {
            const isMedia = netflixIds.has(topic.id);
            const item = document.createElement('div');
            item.className = 'chat-item' + (isMedia ? ' is-media' : '');
            const icon = isMedia ? netflixNames[topic.id].icon : '#';
            item.innerHTML = `
                <div class="chat-avatar">${icon}</div>
                <div class="chat-item-body">
                    <div class="chat-item-top">
                        <span class="chat-item-name">${escapeHtml(topic.title)}</span>
                    </div>
                    <div class="chat-item-sub">${isMedia ? 'Tema multimedia · estilo Netflix disponible' : 'Tema del grupo'}</div>
                </div>`;
            item.onclick = () => this.openChat(topic);
            el.chatList.appendChild(item);
        });
    },

    async openChat(topic) {
        this.activeTopicId = topic.id;
        $$('.chat-item', el.chatList).forEach(c => c.classList.remove('active'));
        const idx = ($$('.chat-item', el.chatList)).find(c => c.querySelector('.chat-item-name').innerText === topic.title);
        if (idx) idx.classList.add('active');

        el.chatHeaderTitle.innerText = topic.title;
        el.chatHeaderMeta.innerText = 'cargando...';
        el.chatMessages.innerHTML = '<div class="chat-loading"><div class="loader small"></div></div>';

        let messages = state.chatCache[topic.id];
        if (!messages) {
            messages = await state.engine.fetchTopicMessages(topic.id, state.engine.cfg.messagesPerChat);
            state.chatCache[topic.id] = messages;
        }
        el.chatHeaderMeta.innerText = `${messages.length} mensajes`;
        this.renderMessages(messages);
    },

    renderMessages(messages) {
        el.chatMessages.innerHTML = '';
        const ordered = messages.slice().reverse(); // antiguos arriba
        if (!ordered.length) {
            el.chatMessages.innerHTML = '<div class="chat-empty">No hay mensajes en este tema.</div>';
            return;
        }
        ordered.forEach(m => {
            const bubble = document.createElement('div');
            bubble.className = 'tg-message';
            const text = m.message || '';
            const sender = (m.fromId && m.fromId.userId) ? ('Usuario ' + m.fromId.userId) : 'Canal';
            const hasMedia = !!m.media;
            const mediaTag = hasMedia ? this._mediaPreview(m) : '';
            bubble.innerHTML = `
                <div class="tg-bubble">
                    ${mediaTag}
                    ${text ? `<div class="tg-text">${this.linkify(escapeHtml(text))}</div>` : ''}
                    <div class="tg-time">${fmtTime(m.date)}</div>
                </div>`;
            // adjuntar reproducción si hay video
            const doc = m.media && m.media.document;
            if (doc && /video/.test(doc.mimeType || '')) {
                bubble.querySelector('.tg-bubble').classList.add('playable');
                bubble.querySelector('.tg-bubble').onclick = () => Player.open({
                    id: m.id, message: m, title: (text.split('\n')[0] || 'Video'),
                    description: text, isVideo: true, year: '', duration: '', size: fmtBytes(doc.size)
                });
            }
            el.chatMessages.appendChild(bubble);
        });
        el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
        // miniaturas lazy
        $$('.tg-media[data-mid]', el.chatMessages).forEach(async node => {
            const mid = Number(node.dataset.mid);
            const msg = ordered.find(x => x.id === mid);
            if (!msg) return;
            const url = await state.engine.downloadThumb(msg);
            if (url) node.style.backgroundImage = `url(${url})`;
        });
    },

    _mediaPreview(m) {
        const doc = m.media.document;
        const isVideo = doc && /video/.test(doc.mimeType || '');
        const label = isVideo ? '▶' : (m.media.photo ? '🖼' : '📎');
        return `<div class="tg-media" data-mid="${m.id}"><span class="tg-media-icon">${label}</span></div>`;
    },

    linkify(text) {
        return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    }
};

/* =====================================================================
 *  LOGIN UI (teléfono + QR)
 * ===================================================================== */
const LoginUI = {
    engine: null,
    _wired: false,
    _qrStarted: false,

    setup(engine) {
        this.engine = engine;
        if (this._wired) return;
        this._wired = true;
        const modal = el.loginModal;
        const tabs = $$('.login-tab', modal);
        const panes = $$('.login-pane', modal);
        tabs.forEach(tab => tab.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            panes.forEach(p => p.hidden = p.dataset.pane !== tab.dataset.tab);
            if (tab.dataset.tab === 'qr') this.initQr();
        });
        this.showStep('phone');
        $('#btn-send-code', modal).onclick = () => this.onSendCode();
        $('#btn-verify-code', modal).onclick = () => this.onVerifyCode();
        $('#btn-verify-password', modal).onclick = () => this.onVerifyPassword();
        $('#btn-back-phone', modal).onclick = () => this.showStep('phone');
        $('#login-phone', modal).addEventListener('keydown', e => { if (e.key === 'Enter') this.onSendCode(); });
        $('#login-code', modal).addEventListener('keydown', e => { if (e.key === 'Enter') this.onVerifyCode(); });
        $('#login-password', modal).addEventListener('keydown', e => { if (e.key === 'Enter') this.onVerifyPassword(); });
    },

    showStep(step) {
        $$('.login-step', el.loginModal).forEach(s => s.hidden = s.dataset.step !== step);
    },

    busy(btn, on) {
        if (!btn) return;
        btn.disabled = on;
        if (on) { btn._t = btn.innerText; btn.innerText = 'Espera...'; }
        else if (btn._t) btn.innerText = btn._t;
    },

    async onSendCode() {
        const phone = $('#login-phone').value.trim();
        if (!phone) { setBoot('Escribe tu número con prefijo de país (ej: +34...).'); return; }
        const btn = $('#btn-send-code');
        this.busy(btn, true); setBoot('Enviando código...');
        try {
            await this.engine.sendCode(phone);
            setBoot('Te enviamos un código. Revísalo en tu app de Telegram.');
            this.showStep('code'); $('#login-code').focus();
        } catch (e) {
            setBoot('No se pudo enviar el código: ' + (e.errorMessage || e.message || e));
        } finally { this.busy(btn, false); }
    },

    async onVerifyCode() {
        const code = $('#login-code').value.trim();
        if (!code) { setBoot('Escribe el código que recibiste.'); return; }
        const btn = $('#btn-verify-code');
        this.busy(btn, true); setBoot('Verificando código...');
        try {
            const r = await this.engine.signInWithCode(code);
            if (r && r.needPassword) {
                setBoot('Tu cuenta tiene verificación en dos pasos. Introduce tu contraseña 2FA.');
                this.showStep('password'); $('#login-password').focus();
            } else {
                this.engine._saveAndReload();
            }
        } catch (e) {
            setBoot('Código incorrecto o caducado: ' + (e.errorMessage || e.message || e));
        } finally { this.busy(btn, false); }
    },

    async onVerifyPassword() {
        const pwd = $('#login-password').value;
        if (!pwd) { setBoot('Escribe tu contraseña 2FA.'); return; }
        const btn = $('#btn-verify-password');
        this.busy(btn, true); setBoot('Comprobando contraseña...');
        try {
            await this.engine.signInWithPassword(pwd);
            this.engine._saveAndReload();
        } catch (e) {
            setBoot('Contraseña 2FA incorrecta: ' + (e.errorMessage || e.message || e));
        } finally { this.busy(btn, false); }
    },

    initQr() {
        if (this._qrStarted) return;
        this._qrStarted = true;
        if (el.qrLoading) el.qrLoading.style.display = 'block';
        if (el.qrCode) el.qrCode.innerHTML = '';
        this.engine.startQrLogin();
    }
};

/* =====================================================================
 *  CONTROLADOR DE VISTAS / BÚSQUEDA
 * ===================================================================== */
const App = {
    switchView(view) {
        state.currentView = view;
        const isNetflix = view === 'netflix';
        el.netflixView.hidden = !isNetflix;
        el.telegramView.hidden = isNetflix;
        el.body.classList.toggle('telegram-mode', !isNetflix);
        el.navNetflix.classList.toggle('active', isNetflix);
        el.navTelegram.classList.toggle('active', !isNetflix);
        if (!isNetflix && !Telegram.activeTopicId && state.topics.length) {
            // abrir el primer tema "off topic" disponible
            const netflixIds = new Set(state.engine.cfg.netflixTopics.map(t => t.id));
            const first = state.topics.find(t => !netflixIds.has(t.id)) || state.topics[0];
            if (first) Telegram.openChat(first);
        }
    },

    search(query) {
        const q = query.trim().toLowerCase();
        if (!q) { el.searchResults.innerHTML = ''; return; }
        const results = state.allMediaItems.filter(it =>
            it.title.toLowerCase().includes(q) ||
            (it.description || '').toLowerCase().includes(q) ||
            it.category.toLowerCase().includes(q));
        if (!results.length) {
            el.searchResults.innerHTML = '<div class="search-empty">Sin resultados para tu búsqueda.</div>';
            return;
        }
        el.searchResults.innerHTML = '';
        results.forEach(it => {
            const card = document.createElement('div');
            card.className = 'search-card';
            card.innerHTML = `
                <img class="search-image" src="${it.thumbnail || placeholderImage(it.id, it.title)}" alt="">
                <div class="search-meta">
                    <h3>${escapeHtml(it.title)}</h3>
                    <p>${escapeHtml((it.description || '').slice(0, 140))}</p>
                    <span class="search-cat">${escapeHtml(it.category)}</span>
                </div>`;
            card.onclick = () => { this.closeSearch(); Player.open(it); };
            el.searchResults.appendChild(card);
        });
    },

    openSearch() { el.searchOverlay.hidden = false; el.searchInput.focus(); el.body.style.overflow = 'hidden'; },
    closeSearch() { el.searchOverlay.hidden = true; el.searchInput.value = ''; el.searchResults.innerHTML = ''; el.body.style.overflow = ''; }
};

/* =====================================================================
 *  ARRANQUE
 * ===================================================================== */
async function boot() {
    try {
        if (!window.CONFIG) throw new Error('CONFIG no definido');
        await Streamer.register();

        const engine = new TelegramEngine(window.CONFIG);
        state.engine = engine;
        Netflix.init();

        const connected = await engine.init();
        if (!connected) return; // se mostró el QR

        setBoot('Cargando temas del grupo...');
        const topics = await engine.fetchTopics();
        state.topics = topics;
        console.log('Temas encontrados:', topics);

        // --- cargar contenido Netflix por tema configurado ---
        for (const cat of engine.cfg.netflixTopics) {
            setBoot(`Cargando ${cat.name}...`);
            const msgs = await engine.fetchTopicMessages(cat.id, engine.cfg.messagesPerTopic);
            const items = msgs
                .filter(m => m.media || (m.message && /https?:\/\//.test(m.message)))
                .map(m => engine.parseMediaItem(m, cat));
            state.netflixData[cat.name] = items;
            state.allMediaItems = state.allMediaItems.concat(items);
            state.chatCache[cat.id] = msgs; // reutilizable en vista Telegram
        }

        Netflix.render();
        Telegram.renderChatList();
        App.switchView('netflix');
    } catch (e) {
        console.error('boot error', e);
        setBoot('Error: ' + e.message);
    } finally {
        if (el.loadingScreen) el.loadingScreen.classList.add('hidden');
    }
}

// ===== EVENTOS UI =====
function wireUi() {
    el.navNetflix.onclick = (e) => { e.preventDefault(); App.switchView('netflix'); };
    el.navTelegram.onclick = (e) => { e.preventDefault(); App.switchView('telegram'); };

    $('.modal-close', el.playerModal).onclick = () => Player.close();
    $('.modal-overlay', el.playerModal).onclick = () => Player.close();

    el.searchBtn.onclick = () => App.openSearch();
    $('.search-close', el.searchOverlay).onclick = () => App.closeSearch();
    el.searchInput.addEventListener('input', e => App.search(e.target.value));

    el.navLinks.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-cat]'); if (!a) return;
        e.preventDefault();
        $$('#nav-links a').forEach(x => x.classList.remove('active'));
        a.classList.add('active');
        const cat = a.dataset.cat;
        if (!cat) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
        const row = $$('.row-title').find(t => t.innerText.includes(cat));
        if (row) row.closest('.content-row').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!el.searchOverlay.hidden) App.closeSearch();
        else if (!el.playerModal.hidden) Player.close();
    });

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) el.navbar.classList.add('scrolled');
        else el.navbar.classList.remove('scrolled');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    wireUi();
    // boot() gestiona internamente la espera de la librería y el CDN alternativo
    boot();
});
