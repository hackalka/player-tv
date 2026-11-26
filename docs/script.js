/* =====================================================================
 * Tv Player — frontend
 *  - Catálogo Netflix (películas/series/deportes) desde la API
 *  - Continuar viendo + Mi lista (favoritos) en localStorage
 *  - Reproductores externos (VLC / AceStream) para mkv/avi/enlaces
 *  - Selector de grupo y catálogo por cuenta de Telegram
 *  - Navegación con mando de TV Box (flechas + OK + atrás)
 * ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const PLACEHOLDER_COLORS = ['#3a1c71', '#b21f1f', '#1a2a6c', '#4b6cb7', '#182848', '#0f2027', '#572d2d', '#2c3e50'];
function placeholderImage(seed, label) {
    const color = PLACEHOLDER_COLORS[Math.abs(hashCode(String(seed))) % PLACEHOLDER_COLORS.length];
    const txt = (label || 'TV').slice(0, 16);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='600'><rect width='100%' height='100%' fill='${color}'/><text x='50%' y='50%' fill='rgba(255,255,255,.85)' font-family='Arial' font-size='26' font-weight='bold' text-anchor='middle' dominant-baseline='middle'>${escapeXml(txt)}</text></svg>`;
    // encodeURIComponent puede fallar con surrogates "rotos" (algunos emojis cortados por slice).
    // Lo blindamos para que no rompa el render del catalogo.
    try { return 'data:image/svg+xml,' + encodeURIComponent(svg); }
    catch (e) {
        const safe = (label || 'TV').replace(/[\uD800-\uDFFF]/g, '').slice(0, 16) || 'TV';
        const svg2 = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='600'><rect width='100%' height='100%' fill='${color}'/><text x='50%' y='50%' fill='rgba(255,255,255,.85)' font-family='Arial' font-size='26' font-weight='bold' text-anchor='middle' dominant-baseline='middle'>${escapeXml(safe)}</text></svg>`;
        try { return 'data:image/svg+xml,' + encodeURIComponent(svg2); }
        catch (e2) { return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='400' height='600'><rect width='100%' height='100%' fill='${color}'/></svg>`); }
    }
}
function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h; }
function escapeXml(s) { return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])); }
function escapeHtml(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
function absUrl(p) { return p ? new URL(p, location.href).href : ''; }

async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    try { const t = localStorage.getItem('tvp_token'); if (t) headers['x-auth-token'] = t; } catch {}
    let r, data;
    // Reintento si el servidor dice 503 (reconectando con Telegram). Hasta 3 intentos.
    for (let attempt = 0; attempt < 3; attempt++) {
        r = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
        data = await r.json().catch(() => ({}));
        if (r.status !== 503 || !(data && data.retry)) break;
        await new Promise(rsv => setTimeout(rsv, 800 + attempt * 600));
    }
    if (r.status === 401 || (data && data.needLogin)) {
        try { localStorage.removeItem('tvp_token'); } catch {}
        if (typeof Login !== 'undefined' && Login && Login.open && el && el.loginModal) {
            el.loadingScreen && el.loadingScreen.classList.add('hidden');
            Login.open();
        } else {
            location.reload();
        }
        throw new Error('Sesión expirada');
    }
    if (!r.ok) throw new Error(data.error || ('Error ' + r.status));
    return data;
}


// Ajustes públicos permitidos por el administrador (sin exponer endpoints privados).
let TVP_ADMIN_CONFIG = {};
let TVP_ADMIN_OVERRIDES = new Map();
async function loadAdminRuntime(groupId) {
    try {
        const [configRes, catalogRes] = await Promise.all([
            fetch('/api/public-config', { credentials: 'same-origin', cache: 'no-store' }),
            fetch('/api/catalog-overrides?group=' + encodeURIComponent(groupId), { credentials: 'same-origin', cache: 'no-store' })
        ]);
        if (configRes.ok) {
            const data = await configRes.json();
            TVP_ADMIN_CONFIG = data.settings || {};
            const root = document.documentElement;
            const color = TVP_ADMIN_CONFIG['ui.accentColor'];
            const bg = TVP_ADMIN_CONFIG['ui.backgroundColor'];
            const radius = TVP_ADMIN_CONFIG['ui.cardRadius'];
            const font = TVP_ADMIN_CONFIG['ui.fontFamily'];
            if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) root.style.setProperty('--netflix-red', color); root.style.setProperty('--netflix-red-hover', color);
            if (typeof bg === 'string' && /^#[0-9a-f]{6}$/i.test(bg)) root.style.setProperty('--netflix-black', bg);
            if (Number.isFinite(Number(radius)) && Number(radius) >= 0 && Number(radius) <= 32) root.style.setProperty('--tvp-card-radius', Number(radius) + 'px');
            if (typeof font === 'string' && /^[a-zA-Z ,'-]{1,60}$/.test(font)) root.style.setProperty('--font-primary', font);
        }
        if (catalogRes.ok) {
            const data = await catalogRes.json();
            TVP_ADMIN_OVERRIDES = new Map((data.items || []).map(x => [String(x.topicId) + ':' + String(x.messageId), x]));
        } else TVP_ADMIN_OVERRIDES = new Map();
    } catch (error) {
        console.warn('[admin-config] No se pudieron cargar ajustes administrativos:', error.message);
        TVP_ADMIN_OVERRIDES = new Map();
    }
}
function applyAdminItemOverride(item, groupId, topicId) {
    if (!item) return null;
    const override = TVP_ADMIN_OVERRIDES.get(String(topicId || item.topicId || '') + ':' + String(item.id));
    if (!override) return item;
    if (override.title) item.title = override.title;
    if (override.description) item.description = override.description;
    if (override.posterUrl) { item.cover = override.posterUrl; item.thumbUrl = override.posterUrl; item.backdrop = override.posterUrl; }
    if (override.genres && override.genres.length) {
        item.meta = Object.assign({}, item.meta || {}, { genres: override.genres.join(', ') });
    }
    return item;
}

/* ===== Almacenamiento local (progreso / favoritos) ===== */
const Store = {
    _get(k, def) { try { return JSON.parse(localStorage.getItem(k)) || def; } catch { return def; } },
    _set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    get progress() { return this._get('tvp_progress', {}); },
    set progress(v) { this._set('tvp_progress', v); },
    get favs() { return this._get('tvp_favs', {}); },
    set favs(v) { this._set('tvp_favs', v); },
    get lastEp() { return this._get('tvp_lastep', {}); },
    set lastEp(v) { this._set('tvp_lastep', v); },
    saveProgress(playable, parent, time, duration) {
        if (!playable || !playable.id || !time || time < 8) return;
        const p = this.progress;
        p[playable.id] = {
            id: playable.id, title: (parent && parent.title) || playable.title || 'Video',
            epTitle: playable.title || '', thumbUrl: (parent && (parent.cover || parent.thumbUrl)) || playable.thumbUrl || '',
            streamUrl: playable.streamUrl || '', externalUrl: playable.externalUrl || '',
            aceUrl: playable.aceUrl || '', ext: playable.ext || '', playableInBrowser: playable.playableInBrowser !== false,
            parentId: (parent && parent.id) || playable.id, time, duration: duration || 0, updated: Date.now()
        };
        this.progress = p;
    },
    clearProgress(id) { const p = this.progress; delete p[id]; this.progress = p; },
    continueList() {
        return Object.values(this.progress)
            .filter(r => r.time > 8 && (!r.duration || r.time < r.duration * 0.95))
            .sort((a, b) => b.updated - a.updated).slice(0, 20);
    },
    isFav(id) { return !!this.favs[id]; },
    toggleFav(item) {
        const f = this.favs;
        if (f[item.id]) delete f[item.id]; else f[item.id] = item;
        this.favs = f; return !!f[item.id];
    },
    favList() { return Object.values(this.favs).reverse(); },
    setLastEp(seriesId, epId) { const l = this.lastEp; l[seriesId] = epId; this.lastEp = l; },
    get volume() { const v = parseFloat(localStorage.getItem('tvp_vol')); return isNaN(v) ? 1 : v; },
    set volume(v) { try { localStorage.setItem('tvp_vol', String(v)); } catch {} },
    get watched() { return this._get('tvp_watched', {}); },
    set watched(v) { this._set('tvp_watched', v); },
    isWatched(id) { return !!this.watched[id]; },
    toggleWatched(id) { const w = this.watched; if (w[id]) delete w[id]; else w[id] = Date.now(); this.watched = w; return !!w[id]; },
};

/* ===== Firebase Firestore (favoritos + continuar viendo en la nube) ===== */
const CloudStore = {
    db: null, uid: null,
    init(userId) {
        try {
            if (!window.firebase || !window.firebase.firestore) return;
            // Usar la config REAL de tg-config.js si tiene apiKey; si no, no conecta.
            const fb = (window.TVP_CONFIG && window.TVP_CONFIG.firebase) || {};
            if (!fb.apiKey || !fb.projectId) {
                console.warn('[firebase] sin claves reales en tg-config.js -> sin sincronizacion en la nube');
                return;
            }
            if (!firebase.apps.length) {
                firebase.initializeApp(fb);
            }
            this.db = firebase.firestore();
            this.uid = String(userId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '');
            console.log('[firebase] conectado a', fb.projectId);
        } catch (e) { console.warn('Firebase init:', e.message); }
    },
    async syncFavs() {
        if (!this.db || !this.uid) return;
        try {
            const doc = await this.db.collection('users').doc(this.uid).get();
            if (doc.exists && doc.data().favs) { Store.favs = Object.assign({}, doc.data().favs, Store.favs); }
            await this.db.collection('users').doc(this.uid).set({ favs: Store.favs }, { merge: true });
        } catch (e) { console.warn('syncFavs:', e.message); }
    },
    async saveFavs() { if (!this.db || !this.uid) return; try { await this.db.collection('users').doc(this.uid).set({ favs: Store.favs }, { merge: true }); } catch {} },
    async syncProgress() {
        if (!this.db || !this.uid) return;
        try {
            const doc = await this.db.collection('users').doc(this.uid).get();
            if (doc.exists && doc.data().progress) {
                const remote = doc.data().progress, local = Store.progress, merged = {};
                new Set([...Object.keys(remote), ...Object.keys(local)]).forEach(k => {
                    const r = remote[k], l = local[k];
                    merged[k] = (!r ? l : !l ? r : ((r.updated || 0) > (l.updated || 0) ? r : l));
                });
                Store.progress = merged;
            }
            await this.db.collection('users').doc(this.uid).set({ progress: Store.progress }, { merge: true });
        } catch (e) { console.warn('syncProgress:', e.message); }
    },
    async saveProgress() { if (!this.db || !this.uid) return; try { await this.db.collection('users').doc(this.uid).set({ progress: Store.progress }, { merge: true }); } catch {} },
    async syncWatched() {
        if (!this.db || !this.uid) return;
        try {
            const doc = await this.db.collection('users').doc(this.uid).get();
            if (doc.exists && doc.data().watched) Store.watched = Object.assign({}, doc.data().watched, Store.watched);
            await this.db.collection('users').doc(this.uid).set({ watched: Store.watched }, { merge: true });
        } catch {}
    },
    async saveWatched() { if (!this.db || !this.uid) return; try { await this.db.collection('users').doc(this.uid).set({ watched: Store.watched }, { merge: true }); } catch {} },
};

const state = {
    catalog: { categories: [] }, allItems: [], itemsById: {},
    groups: [], activeGroup: '', favoriteGroups: [], groupPreferenceKey: 'tvp_selected_group:account',
    account: null
};

const el = {
    body: document.body,
    brand: $('#brand-name'),
    navbar: $('.navbar'),
    navLinks: $('#nav-links'),
    logoutBtn: $('#logout-btn'),
    groupsTabBtn: $('#groups-tab-btn'),
    filterGenre: $('#filter-genre'),
    filterYear: $('#filter-year'),
    filterQuality: $('#filter-quality'),
    filterLang: $('#filter-lang'),
    filterCat: $('#filter-cat'),
    heroImage: $('#hero-image'),
    heroTitle: $('#hero-title'),
    heroDescription: $('#hero-description'),
    heroBadge: $('#hero-badge'),
    heroPlay: $('#hero-play'),
    heroInfo: $('#hero-info'),
    rowsContainer: $('#rows-container'),
    playerModal: $('#player-modal'),
    playerIframe: $('#player-iframe'),
    playerVideo: $('#player-video'),
    playerExit: $('#player-exit'),
    playerStatus: $('#player-status'),
    detailHero: $('#detail-hero'),
    detailBackdrop: $('#detail-backdrop'),
    detailPoster: $('#detail-poster'),
    detailGenres: $('#detail-genres'),
    modalRating: $('#modal-rating'),
    trailerIframe: $('#trailer-iframe'),
    trailerMute: $('#trailer-mute'),
    trailerBtn: $('#trailer-btn'),
    detailPlay: $('#detail-play'),
    favBtn: $('#fav-btn'),
    watchedBtn: $('#watched-btn'),
    playerOptions: $('#player-options'),
    episodeList: $('#episode-list'),
    episodesTrack: $('#episodes-track'),
    sources: $('#sources'),
    sourcesTrack: $('#sources-track'),
    modalTitle: $('#modal-title'),
    modalDescription: $('#modal-description'),
    modalYear: $('#modal-year'),
    modalDuration: $('#modal-duration'),
    searchBtn: $('.search-btn'),
    searchOverlay: $('#search-overlay'),
    searchInput: $('#search-input'),
    searchResults: $('#search-results'),
    loadingScreen: $('#loading-screen'),
    loadingText: $('#loading-text'),
    loginModal: $('#login-modal'),
};

const App = {
    _searchTimer: null,
    _normalize(value) {
        return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    },
    toast(message, duration, error) {
        let node = document.getElementById('tvp-toast');
        if (!node) {
            node = document.createElement('div');
            node.id = 'tvp-toast';
            node.className = 'tvp-toast';
            document.body.appendChild(node);
        }
        clearTimeout(this._toastTimer);
        node.textContent = message;
        node.classList.toggle('error', !!error);
        node.classList.add('show');
        if (duration !== 0) {
            this._toastTimer = setTimeout(() => node.classList.remove('show'), duration || 2200);
        }
    },
    _buildSearchIndex() {
        state.allItems.forEach(item => {
            const title = item.title || '';
            const quality = (title.match(/\b(2160p|4k|uhd|1080p|720p|480p|hdr|hdr10|dolby vision|dv)\b/i) || [])[0];
            const language = (title.match(/\b(latino|castellano|espa[ñn]ol|spanish|english|ingles|vose|vos|dual|subtitulado)\b/i) || [])[0];
            item._quality = quality ? quality.toUpperCase() : '';
            item._lang = language ? language.toLowerCase() : '';
            item._search = this._normalize([
                title, item.description, item.category,
                (item.meta && item.meta.genres) || '',
                String(item.year || ''), item._quality, item._lang
            ].join(' '));
        });
    },
    search() {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this._doSearch(), 180);
    },
    _doSearch() {
        if (!el.searchInput || !el.searchResults) return;
        const query = this._normalize(el.searchInput.value.trim());
        const genre = this._normalize(el.filterGenre && el.filterGenre.value);
        const year = el.filterYear && el.filterYear.value || '';
        const quality = el.filterQuality && el.filterQuality.value || '';
        const language = el.filterLang && el.filterLang.value || '';
        const category = el.filterCat && el.filterCat.value || '';
        if (!query && !genre && !year && !quality && !language && !category) {
            el.searchResults.innerHTML = '';
            return;
        }
        const tokens = query ? query.split(/\s+/).filter(Boolean) : [];
        const results = state.allItems.filter(item => {
            if (!item._search || tokens.some(token => !item._search.includes(token))) return false;
            if (genre && !this._normalize(item.meta && item.meta.genres).includes(genre)) return false;
            if (year && String(item.year) !== year) return false;
            if (quality && item._quality !== quality.toUpperCase()) return false;
            if (language && !item._lang.includes(language.toLowerCase())) return false;
            if (category && item.category !== category) return false;
            return true;
        });
        if (!results.length) {
            el.searchResults.innerHTML = '<div class="search-empty">Sin resultados.</div>';
            return;
        }
        const visible = results.slice(0, 240);
        el.searchResults.innerHTML = visible.map(item => `<div class="search-card focusable" tabindex="0" data-id="${escapeHtml(item.id)}">
            <img class="search-image" src="${escapeHtml(item.thumbUrl || placeholderImage(item.id, item.title))}" alt=""
                onerror="this.src='${placeholderImage(item.id, item.title)}'">
            <div class="search-meta"><h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml((item.description || '').slice(0, 140))}</p>
                <span class="search-cat">${escapeHtml(item.category || '')}</span>
                ${item._quality ? `<span class="search-tag">${escapeHtml(item._quality)}</span>` : ''}
                ${item._lang ? `<span class="search-tag lang">${escapeHtml(item._lang)}</span>` : ''}
            </div></div>`).join('') +
            (results.length > visible.length ? `<div class="search-more">Mostrando ${visible.length} de ${results.length} resultados. Refina tu búsqueda para ver más.</div>` : '');
        $$('#search-results .search-card').forEach(card => {
            card.onclick = () => {
                const item = state.itemsById[card.dataset.id];
                if (!item) return;
                this.closeSearch();
                Detail.open(item);
            };
        });
        TVNav.refresh();
    },
    populateFilters() {
        const genres = new Set(), years = new Set(), qualities = new Set(), languages = new Set(), categories = new Set();
        this._buildSearchIndex();
        state.allItems.forEach(item => {
            if (item.meta && item.meta.genres) {
                item.meta.genres.split(/[,/]/).forEach(value => {
                    const genre = value.trim();
                    if (genre) genres.add(genre);
                });
            }
            if (item.year) years.add(String(item.year));
            if (item._quality) qualities.add(item._quality);
            if (item._lang) languages.add(item._lang);
            if (item.category) categories.add(item.category);
        });
        const options = (values, placeholder, sort) => '<option value="">' + placeholder + '</option>' +
            [...values].sort(sort || ((a, b) => a.localeCompare(b)))
                .map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
        if (el.filterGenre) el.filterGenre.innerHTML = options(genres, 'Todos los géneros');
        if (el.filterYear) el.filterYear.innerHTML = options(years, 'Todos los años', (a, b) => b - a);
        if (el.filterQuality) el.filterQuality.innerHTML = options(qualities, 'Cualquier calidad');
        if (el.filterLang) el.filterLang.innerHTML = options(languages, 'Cualquier idioma');
        if (el.filterCat) el.filterCat.innerHTML = options(categories, 'Todas las categorías');
    },
    openSearch() {
        if (!el.searchOverlay) return;
        el.searchOverlay.hidden = false;
        if (el.searchInput) el.searchInput.focus();
        el.body.style.overflow = 'hidden';
    },
    closeSearch() {
        if (el.searchOverlay) el.searchOverlay.hidden = true;
        if (el.searchInput) el.searchInput.value = '';
        [el.filterGenre, el.filterYear, el.filterQuality, el.filterLang, el.filterCat].forEach(filter => {
            if (filter) filter.value = '';
        });
        if (el.searchResults) el.searchResults.innerHTML = '';
        el.body.style.overflow = '';
    }
};

/* ===== NETFLIX ===== */
const Netflix = {
    _vis(items) { return (items || []).filter(Boolean); },
    render() {
        el.rowsContainer.innerHTML = '';
        const cats = state.catalog.categories.filter(c => c.items && c.items.length);

        el.navLinks.innerHTML = '<li><a href="#" class="active" data-cat="">Inicio</a></li>' +
            '<li><a href="#" data-cat="__groups">Grupos</a></li>' +
            cats.map(c => `<li><a href="#" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)}</a></li>`).join('');

        // Filas dinámicas: Continuar viendo + Mi lista + categorías
        const parentByStream = new Map();
        state.allItems.forEach(item => {
            (item.links || []).forEach(link => {
                const stream = String(link.streamUrl || '').split('?')[0];
                if (stream) parentByStream.set(stream, item);
            });
        });
        const cont = Store.continueList().map(record => {
            const stream = String(record.streamUrl || '').split('?')[0];
            const parent = state.itemsById[record.parentId] || parentByStream.get(stream);
            const poster = parent && (parent.cover || parent.thumbUrl);
            return poster ? Object.assign({}, record, {
                cover: parent.cover || record.cover || '',
                thumbUrl: poster
            }) : record;
        });
        if (cont.length) el.rowsContainer.appendChild(this.row('▶ Continuar viendo', cont, 'continue'));
        const favs = this._vis(Store.favList());
        if (favs.length) el.rowsContainer.appendChild(this.row('❤ Mi lista', favs));

        const novedades = this._vis(state.allItems).filter(it => it.date).sort((a, b) => b.date - a.date).slice(0, 60);
        if (novedades.length) el.rowsContainer.appendChild(this.row('Novedades', novedades));

        const top = this._vis(state.allItems).filter(it => it.meta && parseFloat(it.meta.rating) > 0)
            .sort((a, b) => parseFloat(b.meta.rating) - parseFloat(a.meta.rating)).slice(0, 30);
        top.forEach((it, i) => it._rank = i + 1);
        if (top.length) el.rowsContainer.appendChild(this.row('🔥 Top valorados', top, 'top'));

        if (!cats.length && !cont.length && !favs.length) {
            el.rowsContainer.innerHTML = `<div class="empty-state">No se encontró contenido en los temas con la etiqueta configurada.</div>`;
            return;
        }
        let heroPool = [];
        cats.forEach(c => {
            const vis = this._vis(c.items);
            if (!vis.length) return;
            heroPool = heroPool.concat(vis.slice(0, 5));
            el.rowsContainer.appendChild(this.row(`${c.icon || ''} ${c.name}`, vis));
        });
        if (heroPool.length) {
            this.updateHero(heroPool[0]);
            if (heroPool.length > 1) {
                let i = 0; clearInterval(this._t);
                this._t = setInterval(() => { i = (i + 1) % heroPool.length; this.updateHero(heroPool[i]); }, 10000);
            }
        }
        TVNav.refresh();
    },

    row(title, items, kind) {
        items = kind === 'continue' ? (items || []) : Netflix._vis(items);
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
        // Carga progresiva: render inicial + más al hacer scroll
        const STEP = 12;
        let rendered = 0;
        const renderMore = () => {
            const end = Math.min(rendered + STEP, items.length);
            for (let i = rendered; i < end; i++) track.appendChild(this.card(items[i], kind));
            rendered = end;
        };
        renderMore();
        track.addEventListener('scroll', () => {
            if (rendered >= items.length) return;
            if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 600) renderMore();
        });
        $('.prev', row).onclick = () => track.scrollBy({ left: -800, behavior: 'smooth' });
        $('.next', row).onclick = () => { if (rendered < items.length) renderMore(); track.scrollBy({ left: 800, behavior: 'smooth' }); };
        return row;
    },

    renderCategory(name) {
        const cat = state.catalog.categories.find(c => c.name === name);
        el.rowsContainer.innerHTML = '';
        const visItems = cat ? this._vis(cat.items) : [];
        if (!cat || !visItems.length) { el.rowsContainer.innerHTML = '<div class="empty-state">Sin contenido en ' + escapeHtml(name) + '.</div>'; return; }
        // Fila "Todas" + una fila por cada género
        el.rowsContainer.appendChild(this.row(`${cat.icon || ''} Todas`, visItems));
        const byGenre = {};
        visItems.forEach(it => {
            const gs = (it.meta && it.meta.genres) ? it.meta.genres.split(/[,/]/).map(g => g.trim()).filter(Boolean) : [];
            gs.forEach(g => { (byGenre[g] = byGenre[g] || []).push(it); });
        });
        Object.keys(byGenre).sort().forEach(g => el.rowsContainer.appendChild(this.row('🎭 ' + g, byGenre[g])));
        window.scrollTo({ top: 0, behavior: 'smooth' });
        TVNav.refresh();
    },

    card(item, kind) {
        const card = document.createElement('div');
        card.className = 'card focusable' + (Store.isWatched(item.id) ? ' watched' : '');
        card.dataset.id = String(item.id);
        card.tabIndex = 0;
        const title = item.title || item.epTitle || '';
        const year = item.year || '';
        const img = item.cover || item.thumbUrl || placeholderImage(item.id, title);
        const pct = (kind === 'continue' && item.duration) ? Math.min(100, Math.round(item.time / item.duration * 100)) : 0;
        card.innerHTML = `
            ${kind === 'top' && item._rank ? `<div class="card-rank">${item._rank}</div>` : ''}
            <img class="card-image" src="${img}" alt="${escapeHtml(title)}" loading="lazy"
                 onerror="this.src='${placeholderImage(item.id, title)}'">
            ${Store.isWatched(item.id) ? '<div class="card-watched">VISTO</div>' : ''}
            <div class="card-overlay">
                <h3 class="card-title">${escapeHtml(title)}</h3>
                <div class="card-meta">
                    ${year ? `<span>${escapeHtml(year)}</span>` : ''}
                    ${item.isSeries ? `<span class="badge-series">${item.episodeCount} CAP</span>` : (item.links && item.links.length > 1 ? `<span class="badge-series">${item.links.length} ENLACES</span>` : (item.duration && kind !== 'continue' ? `<span>${escapeHtml(item.duration)}</span>` : ''))}
                    <span class="badge-hd">HD</span>
                </div>
            </div>
            ${pct ? `<div class="card-progress"><span style="width:${pct}%"></span></div>` : ''}
            ${kind === 'continue' ? `<button class="card-remove" title="Quitar de Continuar viendo" aria-label="Quitar">✕</button>` : ''}
            <div class="card-actions">
                <button class="card-action-btn primary play-btn" title="Reproducir"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></button>
            </div>`;
        const onActivate = () => {
            if (kind === 'continue') Detail.resume(item);
            else Detail.open(item);
        };
        $('.play-btn', card).onclick = (e) => { e.stopPropagation(); kind === 'continue' ? Detail.resume(item) : Detail.open(item, { autoplay: true }); };
        const rm = $('.card-remove', card);
        if (rm) rm.onclick = (e) => { e.stopPropagation(); Store.clearProgress(item.id); Netflix.render(); };
        card.onclick = onActivate;
        return card;
    },

    updateHero(item) {
        if (!item) return;
        el.heroImage.src = item.backdrop || item.cover || item.thumbUrl || placeholderImage(item.id, item.title);
        el.heroImage.onerror = () => { el.heroImage.src = placeholderImage(item.id, item.title); };
        el.heroTitle.innerText = item.title || '';
        el.heroDescription.innerText = item.description || '';
        el.heroBadge.innerText = item.category || '';
        el.heroPlay.onclick = () => Detail.open(item, { autoplay: true });
        el.heroInfo.onclick = () => Detail.open(item);
    }
};

/* ===== DETALLE + favoritos + reproductores externos ===== */
const Detail = {
    current: null,
    primary: null,
    open(item, opts = {}) {
        this.current = item;
        const eps = item.episodes || [];
        const hasLinks = !!(item.links && item.links.length);
        el.modalTitle.innerText = item.title || '';
        el.modalYear.innerText = item.year || '';
        el.modalDuration.innerText = (eps.length > 1) ? `${eps.length} episodios`
            : (hasLinks ? `${item.links.length} ${item.links.length === 1 ? 'enlace' : 'enlaces'}`
            : (item.duration || (eps[0] && eps[0].duration) || item.size || ''));
        el.modalDescription.hidden = hasLinks;
        el.modalDescription.innerText = item.description || 'Sin descripción disponible.';
        const rating = item.meta && item.meta.rating;
        const genres = item.meta && item.meta.genres;
        if (el.modalRating) el.modalRating.innerText = rating ? ('★ ' + rating) : '';
        if (el.detailGenres) {
            const gs = genres ? String(genres).split(/[,/]/).map(g => g.trim()).filter(Boolean) : [];
            el.detailGenres.innerHTML = gs.map(g => `<span class="chip">${escapeHtml(g)}</span>`).join('');
        }
        const backdrop = item.backdrop || item.cover || item.thumbUrl || (eps[0] && eps[0].thumbUrl) || placeholderImage(item.id, item.title);
        const poster = item.cover || item.thumbUrl || (eps[0] && eps[0].thumbUrl) || placeholderImage(item.id, item.title);
        el.detailBackdrop.src = backdrop;
        el.detailBackdrop.onerror = () => { el.detailBackdrop.src = placeholderImage(item.id, item.title); };
        if (el.detailPoster) { el.detailPoster.src = poster; el.detailPoster.onerror = () => { el.detailPoster.src = placeholderImage(item.id, item.title); }; }

        // Trailer YouTube (autoplay muted) — Netflix style con detección de errores
        const trailerKey = item.trailerKey || item.trailer;
        Detail._stopTrailer();
        Detail._currentTrailer = trailerKey || '';
        if (el.trailerBtn) {
            el.trailerBtn.hidden = !trailerKey;
            el.trailerBtn.onclick = () => { if (Detail._currentTrailer) Detail._loadTrailer(Detail._currentTrailer, true); };
        }
        if (trailerKey && el.trailerIframe) {
            Detail._trailerTimer = setTimeout(() => {
                if (el.playerModal.hidden) return;
                Detail._loadTrailer(trailerKey);
            }, 1500);
        }

        this.resetVideo();
        this.resetSources();
        this.updateFav();
        el.playerModal.hidden = false;
        el.body.style.overflow = 'hidden';

        let primary;
        if (eps.length > 1) {
            el.episodeList.hidden = false;
            this.renderEpisodes(eps, item);
            const lastId = Store.lastEp[item.id];
            primary = eps.find(e => String(e.id) === String(lastId)) || eps[0];
        } else if (hasLinks) {
            el.episodeList.hidden = true;
            primary = this.renderSources(item);
        } else {
            el.episodeList.hidden = true;
            primary = eps[0] || item;
        }
        this.primary = primary;
        ExternalPlayers.render(primary);
        this._loadFilmAffinityMetadata(item);
        el.detailPlay.onclick = () => Player.play(Detail.primary, item);
        el.favBtn.onclick = () => { Store.toggleFav(item); this.updateFav(); CloudStore.saveFavs(); };
        if (el.watchedBtn) {
            this.updateWatched();
            el.watchedBtn.onclick = () => { Store.toggleWatched(item.id); this.updateWatched(); CloudStore.saveWatched && CloudStore.saveWatched(); Netflix.render(); };
        }
        if (opts.autoplay) Player.play(primary, item);
        TVNav.refresh();
        setTimeout(() => el.detailPlay.focus(), 50);
    },

    _loadFilmAffinityMetadata(item) {
        const link = (item.metadataLinks || []).find(candidate =>
            candidate.metadataSource && candidate.metadataSource.kind === 'filmaffinity'
        );
        if (!link || (item.description && item.cover) || item._metadataRequest) return;

        const request = fetch('/api/metadata/filmaffinity?url=' + encodeURIComponent(link.url), {
            headers: { Accept: 'application/json' }
        }).then(async response => {
            if (!response.ok) throw new Error('FilmAffinity respondió con HTTP ' + response.status);
            const metadata = await response.json();
            if (!item.description && metadata.description) item.description = String(metadata.description);
            if (!item.cover && metadata.poster) item.cover = String(metadata.poster);
            if (!item.backdrop && item.cover) item.backdrop = item.cover;
            if (!item.year && metadata.year) item.year = String(metadata.year);
            if (this.current === item && !el.playerModal.hidden) this._updateFilmAffinityView(item);
        }).catch(error => {
            console.warn('[metadata] FilmAffinity no se pudo cargar:', error.message);
        }).finally(() => {
            if (item._metadataRequest === request) delete item._metadataRequest;
        });
        item._metadataRequest = request;
    },

    _updateFilmAffinityView(item) {
        el.modalYear.innerText = item.year || '';
        if (!el.modalDescription.hidden) {
            el.modalDescription.innerText = item.description || 'Sin descripción disponible.';
        }
        if (item.cover) {
            if (el.detailPoster) el.detailPoster.src = item.cover;
            el.detailBackdrop.src = item.backdrop || item.cover;
            $$('.card, .search-card').forEach(card => {
                if (card.dataset.id !== String(item.id)) return;
                const image = $('img', card);
                if (image) image.src = item.cover;
            });
        }
        if (item.description) {
            $$('.source-btn', el.sourcesTrack).forEach(button => {
                let synopsis = $('.source-description', button);
                if (!synopsis) {
                    synopsis = document.createElement('span');
                    synopsis.className = 'source-description';
                    button.appendChild(synopsis);
                }
                synopsis.textContent = '📜 ' + item.description;
            });
        }
    },

    // Lista de fuentes reproducibles. Cada una con un boton "▶ Play" (etiqueta limpia).
    // Si el post original tiene una etiqueta especifica (calidad, idioma, "DAZN 1"...),
    // la mostramos pequeña al lado. Si no, ponemos solo "▶ Play 1, 2, 3...".
    renderSources(item) {
        el.sources.hidden = false;
        el.sourcesTrack.innerHTML = '';
        const playables = item.links.map((l, i) => this._linkToPlayable(item, l, i));
        playables.forEach((pl, i) => {
            const raw = String(item.links[i].label || '').trim();
            // Detectar si la etiqueta original es algo util (calidad/idioma/DAZN/canal),
            // o un genérico tipo "Enlace 1" que conviene reemplazar.
            const isGeneric = !raw || /^enlace\s*\d*$/i.test(raw) || /^link\s*\d*$/i.test(raw) || /^opci[oó]n\s*\d*$/i.test(raw);
            const tag = pl.aceUrl ? 'AceStream' : pl.tvgramUrl ? 'TVGram' : (pl.playableInBrowser === false ? (item.links[i].kind === 'tg' ? 'Telegram' : 'Externo') : '');
            const sub = isGeneric ? '' : raw;
            const main = `▶ Play ${playables.length > 1 ? (i + 1) : ''}`.trim();
            const ico = pl.aceUrl ? '📡' : pl.tvgramUrl ? '📺' : '▶';
            const synopsis = item.description ? `<span class="source-description">📜 ${escapeHtml(item.description)}</span>` : '';
            const label = `<span class="source-ico">${ico}</span><span class="source-main">${escapeHtml(main)}</span>${sub ? `<span class="source-sub">${escapeHtml(sub)}</span>` : ''}${tag ? `<span class="source-tag">${escapeHtml(tag)}</span>` : ''}${synopsis}`;
            let node;
            if (pl.aceUrl) {
                node = document.createElement('a');
                node.href = pl.aceUrl; node.className = 'source-btn ace focusable'; node.tabIndex = 0; node.innerHTML = label;
                node.onclick = () => { Detail.primary = pl; };
            } else if (pl.tvgramUrl) {
                // Enlace tvgram:// → abrir directamente en la app TVGram Player
                node = document.createElement('a');
                node.href = ExternalPlayers.tvgramHref(pl.tvgramUrl);
                node.className = 'source-btn tvgram focusable'; node.tabIndex = 0; node.innerHTML = label;
                node.onclick = () => { Detail.primary = pl; ExternalPlayers.render(pl); };
            } else if (!pl.streamUrl && pl.externalUrl) {
                node = document.createElement('a');
                node.href = pl.externalUrl; node.target = '_blank'; node.rel = 'noopener';
                node.className = 'source-btn focusable'; node.tabIndex = 0; node.innerHTML = label;
                node.onclick = () => { Detail.primary = pl; };
            } else {
                node = document.createElement('button');
                node.className = 'source-btn focusable'; node.tabIndex = 0; node.innerHTML = label;
                node.onclick = () => {
                    $$('.source-btn', el.sourcesTrack).forEach(b => b.classList.remove('active'));
                    node.classList.add('active');
                    Detail.primary = pl; ExternalPlayers.render(pl); Player.play(pl, item);
                };
            }
            el.sourcesTrack.appendChild(node);
        });
        return playables[0];
    },

    _linkToPlayable(item, link, i) {
        return {
            id: item.id + '-l' + i,
            title: link.label,
            streamUrl: link.streamUrl || '',
            aceUrl: link.aceUrl || '',
            tvgramUrl: link.tvgramUrl || '',
            externalUrl: link.externalUrl || '',
            playableInBrowser: link.playableInBrowser === true,
            ext: link.ext || '',
            thumbUrl: link.thumbUrl || item.thumbUrl
        };
    },

    resetSources() { el.sources.hidden = true; el.sourcesTrack.innerHTML = ''; },

    _descWithMeta(item) {
        let desc = item.description || 'Sin descripción disponible.';
        const m = item.meta || {};
        const bits = [];
        if (m.genres) bits.push(m.genres);
        if (m.rating) bits.push('★ ' + m.rating);
        if (m.seasons) bits.push(m.seasons + (m.seasons === '1' ? ' temporada' : ' temporadas'));
        if (m.status) bits.push(m.status);
        return bits.length ? bits.join('  ·  ') + '\n\n' + desc : desc;
    },

    // Reanudar desde una tarjeta de "Continuar viendo"
    resume(record) {
        const parent = state.itemsById[record.parentId];
        if (parent) { this.open(parent, { autoplay: true }); return; }
        this.current = record; this.primary = record;
        el.modalTitle.innerText = record.title;
        el.modalDescription.innerText = '';
        el.modalYear.innerText = ''; el.modalDuration.innerText = '';
        el.detailBackdrop.src = record.thumbUrl || placeholderImage(record.id, record.title);
        el.episodeList.hidden = true;
        this.resetVideo(); this.resetSources(); this.updateFav();
        el.playerModal.hidden = false; el.body.style.overflow = 'hidden';
        ExternalPlayers.render(record);
        el.detailPlay.onclick = () => Player.play(record, record);
        Player.play(record, record);
        TVNav.refresh();
    },

    updateFav() {
        const it = this.current;
        const fav = it && Store.isFav(it.id);
        el.favBtn.querySelector('.fav-ico').innerText = fav ? '✓' : '＋';
    },
    updateWatched() {
        const it = this.current; if (!it || !el.watchedBtn) return;
        const w = Store.isWatched(it.id);
        el.watchedBtn.querySelector('.watched-txt').innerText = w ? 'Visto' : 'Marcar como visto';
        el.watchedBtn.classList.toggle('active', w);
    },

    renderEpisodes(eps, parent) {
        el.episodesTrack.innerHTML = '';
        const bySeason = {};
        eps.forEach(ep => { const s = ep.season || 1; (bySeason[s] = bySeason[s] || []).push(ep); });
        const seasons = Object.keys(bySeason).map(Number).sort((a, b) => a - b);

        const renderList = (list, container, grouped) => {
            container.innerHTML = '';
            list.forEach((ep, i) => {
                const row = document.createElement('div');
                row.className = 'episode focusable'; row.tabIndex = 0;
                const thumb = ep.thumbUrl || placeholderImage(ep.id, ep.title);
                const prog = Store.progress[ep.id];
                const pct = prog && prog.duration ? Math.min(100, Math.round(prog.time / prog.duration * 100)) : 0;
                const name = grouped ? ('Capítulo ' + (ep.epNum || (i + 1))) : ep.title;
                row.innerHTML = `
                    <div class="episode-index">${ep.epNum || (i + 1)}</div>
                    <img class="episode-thumb" src="${thumb}" alt="" onerror="this.src='${placeholderImage(ep.id, ep.title)}'">
                    <div class="episode-info">
                        <div class="episode-name">${escapeHtml(name)}</div>
                        <div class="episode-sub">${escapeHtml(ep.duration || ep.size || '')}${pct ? ` · ${pct}% visto` : ''}</div>
                    </div>
                    <span class="episode-play"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span>`;
                row.onclick = () => { ExternalPlayers.render(ep); Player.play(ep, parent); };
                container.appendChild(row);
            });
            TVNav.refresh();
        };

        if (seasons.length > 1) {
            const tabs = document.createElement('div'); tabs.className = 'season-tabs';
            const cont = document.createElement('div'); cont.className = 'season-eps';
            seasons.forEach(s => {
                const b = document.createElement('button');
                b.className = 'season-tab focusable'; b.tabIndex = 0; b.innerText = 'Temporada ' + s;
                b.onclick = () => { $$('.season-tab', tabs).forEach(x => x.classList.remove('active')); b.classList.add('active'); renderList(bySeason[s], cont, true); };
                tabs.appendChild(b);
            });
            el.episodesTrack.appendChild(tabs);
            el.episodesTrack.appendChild(cont);
            const lastId = Store.lastEp[parent.id];
            let def = seasons[0]; const le = eps.find(e => String(e.id) === String(lastId)); if (le) def = le.season || 1;
            const idx = Math.max(0, seasons.indexOf(def));
            $$('.season-tab', tabs)[idx].classList.add('active');
            renderList(bySeason[def], cont, true);
        } else {
            renderList(eps, el.episodesTrack, false);
        }
    },

    resetVideo() {
        el.playerVideo.hidden = true;
        if (el.playerExit) el.playerExit.hidden = true;
        try { el.playerVideo.pause(); } catch {}
        el.playerVideo.removeAttribute('src'); el.playerVideo.load();
        // Destruir Artplayer + hls.js si estuvieran montados
        if (window.ArtBridge) { try { window.ArtBridge.destroy(); } catch {} }
        el.playerIframe.hidden = true; el.playerIframe.src = '';
        el.detailBackdrop.hidden = false;
        el.detailHero.classList.remove('playing');
        el.playerStatus.hidden = true;
    },
    _fmtRuntime(min) {
        const m = Number(min) || 0;
        if (!m) return '';
        const h = Math.floor(m / 60), r = m % 60;
        return h ? `${h}h ${r}m` : `${r}m`;
    },
    _fmtMoney(n) {
        const v = Number(n) || 0; if (!v) return '';
        return '$' + v.toLocaleString('en-US');
    },
    _stopTrailer() {
        if (Detail._trailerTimer) { clearTimeout(Detail._trailerTimer); Detail._trailerTimer = null; }
        if (Detail._ytPlayer) { try { Detail._ytPlayer.destroy(); } catch {} Detail._ytPlayer = null; }
        if (el.trailerIframe) { el.trailerIframe.hidden = true; el.trailerIframe.src = 'about:blank'; }
        if (el.trailerMute) el.trailerMute.hidden = true;
    },
    _loadTrailer(key, manual) {
        if (manual) Detail._stopTrailer();
        // Asegurarse de que la API de YouTube está cargada
        const tryCreate = () => {
            if (!window.YT || !window.YT.Player) { setTimeout(tryCreate, 200); return; }
            try {
                el.trailerIframe.hidden = false;
                Detail._ytPlayer = new YT.Player('trailer-iframe', {
                    videoId: key,
                    host: 'https://www.youtube-nocookie.com',
                    playerVars: {
                        autoplay: 1, mute: manual ? 0 : 1, controls: manual ? 1 : 0, showinfo: 0, modestbranding: 1,
                        rel: 0, loop: 1, playlist: key, playsinline: 1, iv_load_policy: 3, disablekb: 1, fs: 0
                    },
                    events: {
                        onReady: (e) => {
                            try { if (manual) { e.target.unMute(); } else { e.target.mute(); } e.target.playVideo(); } catch {}
                            el.trailerMute.hidden = false;
                            el.trailerMute.innerText = manual ? '🔊' : '🔇';
                            el.trailerMute.dataset.muted = manual ? '0' : '1';
                        },
                        onError: (e) => {
                            // 101 / 150 / 153 = embed deshabilitado o configuración no válida
                            // Otros: 2 (param invalido), 5 (HTML5), 100 (no encontrado)
                            console.warn('YT error:', e.data, '— ocultando trailer');
                            Detail._stopTrailer();
                        },
                        onStateChange: (e) => {
                            // 0 = ended -> reiniciar el loop manual (algunos vídeos ignoran loop=1)
                            if (e.data === 0 && Detail._ytPlayer) { try { Detail._ytPlayer.seekTo(0); Detail._ytPlayer.playVideo(); } catch {} }
                        }
                    }
                });
            } catch (err) { console.warn('YT init', err.message); Detail._stopTrailer(); }
        };
        // Cargar YouTube IFrame API si aún no está
        if (!window.YT || !window.YT.Player) {
            if (!document.getElementById('yt-iframe-api')) {
                const s = document.createElement('script');
                s.id = 'yt-iframe-api'; s.src = 'https://www.youtube.com/iframe_api';
                document.head.appendChild(s);
            }
        }
        tryCreate();
    },
    toggleTrailerSound() {
        if (!Detail._ytPlayer) return;
        try {
            if (Detail._ytPlayer.isMuted()) { Detail._ytPlayer.unMute(); el.trailerMute.innerText = '🔊'; el.trailerMute.dataset.muted = '0'; }
            else { Detail._ytPlayer.mute(); el.trailerMute.innerText = '🔇'; el.trailerMute.dataset.muted = '1'; }
        } catch {}
    },

    close() {
        Player.flushProgress();
        Detail._stopTrailer();
        el.playerModal.hidden = true;
        el.body.style.overflow = '';
        this.resetVideo();
        // refrescar filas (continuar viendo / favoritos)
        Netflix.render();
        TVNav.refresh();
    }
};

/* ===== Reproductores externos (VLC / AceStream / TVGram / copiar) ===== */
const ExternalPlayers = {
    // Construye el enlace para abrir un tvgram:// en la app TVGram Player.
    // En Android usa un intent (con package si está configurado) para abrir la
    // app o llevar al Play Store; en iOS/desktop navega al esquema directamente.
    tvgramHref(url) {
        const cfg = window.TVP_CONFIG || {};
        const ua = navigator.userAgent || '';
        if (/Android/i.test(ua)) {
            const rest = String(url).replace(/^tvgram:\/\//i, '');
            const pkg = (cfg.tvgramPackage || '').trim();
            const pkgPart = pkg ? `package=${pkg};` : '';
            return `intent://${rest}#Intent;scheme=tvgram;${pkgPart}action=android.intent.action.VIEW;end`;
        }
        return url; // iOS / macOS / Windows: el SO enruta el esquema tvgram://
    },

    // Construye el enlace t.me del mensaje de Telegram a partir del streamUrl.
    // - tgstream/<topic>/<msg>      -> grupo principal (cfg.groupId) => t.me/c/<id>[/<topic>]/<msg>
    // - tgstreamlink/<canal>/<msg>  -> enlace t.me ya conocido (canal con -100 o @usuario)
    tmeLink(playable) {
        if (!playable || !playable.streamUrl) return '';
        const su = String(playable.streamUrl);
        let m = su.match(/^tgstream\/(\d+)\/(\d+)/);
        if (m) {
            const topic = m[1], msg = m[2];
            const cfg = window.TVP_CONFIG || {};
            let groupId = cfg.groupId || '';
            try { groupId = new URL(su, location.href).searchParams.get('group') || groupId; } catch {}
            const gid = String(groupId).replace(/^-100/, '').replace(/^-/, '');
            if (!gid) return '';
            return (topic && topic !== '0' && topic !== '1')
                ? `https://t.me/c/${gid}/${topic}/${msg}`
                : `https://t.me/c/${gid}/${msg}`;
        }
        m = su.match(/^tgstreamlink\/([^/]+)\/(\d+)/);
        if (m) {
            const ch = decodeURIComponent(m[1]), msg = m[2];
            if (/^-100\d+$/.test(ch)) return `https://t.me/c/${ch.replace(/^-100/, '')}/${msg}`;
            if (/^-?\d+$/.test(ch)) return `https://t.me/c/${ch.replace(/^-/, '')}/${msg}`;
            return `https://t.me/${ch.replace(/^@/, '')}/${msg}`;
        }
        return '';
    },

    // Enlace para abrir el vídeo de Telegram en TVGram Player:
    //   tvgram://play?url=<enlace t.me>   (envuelto en intent:// en Android)
    tvgramPlayHref(playable) {
        const tme = this.tmeLink(playable);
        if (!tme) return '';
        return this.tvgramHref('tvgram://play?url=' + encodeURIComponent(tme));
    },

    // Panel dedicado para un enlace tvgram:// con botón destacado.
    renderTvgram(url, playable) {
        const box = el.playerOptions; if (!box) return;
        const href = this.tvgramHref(url);
        const items = [
            `<a class="opt-btn primary focusable" tabindex="0" href="${escapeHtml(href)}">📺 Abrir en TVGram Player</a>`,
            `<a class="opt-btn external focusable" tabindex="0" href="${escapeHtml(url)}">📺 Abrir (esquema directo)</a>`,
            `<button class="opt-btn external focusable" tabindex="0" type="button" onclick="navigator.clipboard && navigator.clipboard.writeText(${JSON.stringify(url)})">📋 Copiar enlace</button>`
        ];
        box.hidden = false;
        box.innerHTML = `<div class="opt-label">Este enlace se abre en la app TVGram Player:</div><div class="opt-row">${items.join('')}</div>`;
    },

    render(playable) {
        const box = el.playerOptions;
        box.innerHTML = '';
        if (!playable) { box.hidden = true; return; }
        const items = [];
        let label = 'Otros reproductores:';

        if (playable.aceUrl) {
            // AceStream: reproductor dedicado.
            items.push(`<a class="opt-btn ace focusable" tabindex="0" href="${escapeHtml(playable.aceUrl)}">▶ AceStream</a>`);
            const id = (playable.aceUrl.match(/[0-9a-fA-F]{40}/) || [''])[0];
            if (id) items.push(`<a class="opt-btn focusable" tabindex="0" href="intent:#Intent;scheme=acestream;package=org.acestream.media;S.content_id=${id};end">AceStream (Android)</a>`);
            label = 'Enlace AceStream: ábrelo con tu reproductor.';
        } else if (playable.tvgramUrl) {
            // Enlace tvgram:// explícito (lo puso un admin): abrir en TVGram Player.
            items.push(`<a class="opt-btn primary tvgram focusable" tabindex="0" href="${escapeHtml(this.tvgramHref(playable.tvgramUrl))}">📺 Abrir en TVGram Player</a>`);
            label = 'Este enlace se abre en la app TVGram Player:';
        } else if (playable.streamUrl && playable.playableInBrowser === false) {
            // Vídeo de Telegram que el navegador no puede decodificar (MKV/AVI/4K).
            const hasNative = Player._hasNative() && Player._streamRef(playable);
            if (hasNative) {
                items.push(`<button class="opt-btn primary focusable" tabindex="0" type="button" onclick="Player._playNative(${JSON.stringify(playable).replace(/"/g, '&quot;')}, Player.current && Player.current.parent)">▶ Reproducir</button>`);
                items.push(`<button class="opt-btn focusable" tabindex="0" type="button" onclick="Player._openWithNative(${JSON.stringify(playable).replace(/"/g, '&quot;')}, Player.current && Player.current.parent)">📂 Abrir con...</button>`);
                label = `Formato ${(playable.ext || '').toUpperCase()} — reprodúcelo en la app o elige otro reproductor:`;
            } else {
                items.push(`<button class="opt-btn primary focusable" tabindex="0" type="button" onclick="Player._playHere && Player._playHere()">▶ Reproducir aquí</button>`);
                items.push(`<button class="opt-btn focusable" tabindex="0" type="button" onclick="if(window.MkvPlayer)MkvPlayer.play(${JSON.stringify(playable).replace(/"/g, '&quot;')})">⚡ Motor avanzado</button>`);
                const dl = absUrl(playable.streamUrl) + (absUrl(playable.streamUrl).indexOf('?') >= 0 ? '&' : '?') + 'download=1';
                items.push(`<a class="opt-btn external focusable" tabindex="0" href="${escapeHtml(dl)}" download>⬇ Descargar</a>`);
                label = `Formato ${(playable.ext || '').toUpperCase()} no compatible con el navegador. Elige cómo verlo:`;
            }
        } else if (!playable.streamUrl && playable.externalUrl) {
            items.push(`<a class="opt-btn focusable" tabindex="0" href="${escapeHtml(playable.externalUrl)}" target="_blank" rel="noopener">Abrir enlace</a>`);
        }

        if (!items.length) { box.hidden = true; return; }
        box.hidden = false;
        box.innerHTML = `<div class="opt-label">${escapeHtml(label)}</div><div class="opt-row">${items.join('')}</div>`;
    },

    // Panel cuando se intenta abrir externamente una URL concreta (acestream / stream del servidor)
    renderForUrl(url, playable, info) {
        const box = el.playerOptions; if (!box) return;
        const isAce = info && info.isAce;
        const items = [];
        if (isAce) {
            items.push(`<a class="opt-btn ace focusable" tabindex="0" href="${escapeHtml(url)}">▶ Abrir en AceStream</a>`);
            const id = (url.match(/[0-9a-fA-F]{40}/) || [''])[0];
            if (id) items.push(`<a class="opt-btn focusable" tabindex="0" href="intent:#Intent;scheme=acestream;package=org.acestream.media;S.content_id=${id};end">AceStream (Android/TV)</a>`);
        } else {
            // Vídeo de Telegram no compatible con el navegador (mkv/avi/etc.).
            // En la versión cliente la URL solo funciona DENTRO de la pestaña (la
            // sirve un Service Worker), así que VLC u otra app externa no la podrían
            // abrir directamente. La forma fiable: descargar el fichero y abrirlo
            // con el reproductor del sistema (VLC/MX Player/MPV).
            const dl = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'download=1';
            const fn = (playable && (playable.filename || (playable.title || 'video') + (playable.ext ? '.' + playable.ext : ''))) || 'video';
            // Reproductor NATIVO de la APK (ExoPlayer/libVLC) — máxima prioridad.
            const hasNative = Player._hasNative() && Player._streamRef(playable);
            if (hasNative) {
                // Reproducir dentro de la app con el motor nativo (MKV/AVI/4K).
                items.push(`<button class="opt-btn primary focusable" tabindex="0" type="button" onclick="Player._playNative(${JSON.stringify(playable).replace(/"/g, '&quot;')}, Player.current && Player.current.parent)">▶ Reproducir</button>`);
                // "Abrir con...": selector del sistema para elegir OTRO reproductor.
                items.push(`<button class="opt-btn focusable" tabindex="0" type="button" onclick="Player._openWithNative(${JSON.stringify(playable).replace(/"/g, '&quot;')}, Player.current && Player.current.parent)">📂 Abrir con...</button>`);
            } else {
                // Navegador (sin APK nativa): intentar reproducir aquí o motor avanzado.
                items.push(`<button class="opt-btn primary focusable" tabindex="0" type="button" onclick="Player._playHere && Player._playHere()">▶ Reproducir aquí</button>`);
                items.push(`<button class="opt-btn focusable" tabindex="0" type="button" onclick="if(window.MkvPlayer)MkvPlayer.play(${JSON.stringify(playable).replace(/"/g, '&quot;')})">⚡ Motor avanzado (convertir)</button>`);
            }
            // Descargar siempre disponible.
            items.push(`<a class="opt-btn external focusable" tabindex="0" href="${escapeHtml(dl)}" download="${escapeHtml(fn)}">⬇ Descargar</a>`);
        }
        const label = isAce
            ? 'Si tu reproductor AceStream no se ha abierto solo, pulsa una opción:'
            : `Formato${info && info.ext ? ' ' + info.ext.toUpperCase() : ''} no compatible con el navegador. Elige cómo verlo:`;
        box.hidden = false;
        box.innerHTML = `<div class="opt-label">${escapeHtml(label)}</div><div class="opt-row">${items.join('')}</div>`;
    },

    // Tras descargar el archivo, abre el menú nativo del móvil para compartirlo
    // con cualquier app instalada (VLC, MX Player, etc.).
    async shareDownloaded(downloadUrl, filename) {
        try {
            const r = await fetch(downloadUrl);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const blob = await r.blob();
            const file = new File([blob], filename || 'video', { type: blob.type || 'video/mp4' });
            await navigator.share({ files: [file], title: filename });
        } catch (e) { alert('No se pudo compartir: ' + (e.message || e)); }
    }
};

/* ===== Reproductor ===== */
const Player = {
    current: null,
    play(playable, parent) {
        if (!playable) return;
        Detail._stopTrailer();
        this.flushProgress();
        this.current = { playable, parent };
        if (parent && parent.episodes && parent.episodes.length > 1) Store.setLastEp(parent.id, playable.id);

        // 1) AceStream: nunca dentro -> abrir reproductor externo (acestream://)
        if (playable.aceUrl) {
            this._openExternal(playable.aceUrl, playable);
            return;
        }
        // 1b) tvgram:// -> abrir en la app TVGram Player (deep link)
        if (playable.tvgramUrl) {
            this._openTvgram(playable.tvgramUrl, playable);
            return;
        }
        // 2) Vídeo de Telegram (streamUrl) -> intentar dentro si es navegador-compatible
        if (playable.streamUrl && playable.playableInBrowser !== false) {
            this._playInside(playable, parent);
            return;
        }
        // 3) Vídeo de Telegram NO compatible (mkv/avi):
        //    a) Si estamos en la APK con reproductor NATIVO (ExoPlayer) -> usarlo.
        //    b) Si no, menú de reproductores externos / motor avanzado.
        if (playable.streamUrl) {
            if (this._hasNative() && this._playNative(playable, parent)) return;
            this._openExternal(absUrl(playable.streamUrl), playable);
            return;
        }
        // 4) Enlace externo http(s): si parece vídeo directo, intentar dentro; si no, abrir externo
        if (playable.externalUrl) {
            if (/\.(mp4|m4v|webm|ogg|ogv|mov|m3u8)(\?|#|$)/i.test(playable.externalUrl)) {
                el.detailHero.classList.add('playing'); el.detailBackdrop.hidden = true; el.playerStatus.hidden = true;
                el.playerIframe.hidden = true; el.playerIframe.src = '';
                // Reusamos _playInside con un playable temporal cuyo streamUrl sea la externalUrl,
                // asi entra por Artplayer/hls.js si .m3u8 o por <video> nativo si no.
                const synthetic = Object.assign({}, playable, { streamUrl: playable.externalUrl });
                this._playInside(synthetic, parent);
                return;
            }
            this._openExternal(playable.externalUrl, playable);
            return;
        }
        // 5) Nada que reproducir
        this._showError('No hay vídeo asociado a este elemento.', playable);
    },

    _playInside(playable, parent) {
        el.detailHero.classList.add('playing');
        if (el.playerExit) el.playerExit.hidden = false;
        el.detailBackdrop.hidden = true;
        el.playerStatus.hidden = true;
        el.playerIframe.hidden = true; el.playerIframe.src = '';

        const url = playable.streamUrl;
        const resume = (Store.progress[playable.id] || {}).time || 0;

        // Preferir Artplayer (mejor UX, gestos, DPad). Fallback a <video> nativo.
        if (window.ArtBridge && typeof Artplayer !== 'undefined') {
            el.playerVideo.hidden = true;
            const ok = window.ArtBridge.load(url, {
                title: (parent && parent.title) || playable.title || '',
                poster: (parent && parent.poster) || playable.poster || '',
                volume: Number.isFinite(Number(TVP_ADMIN_CONFIG['player.volume'])) ? Math.max(0, Math.min(1, Number(TVP_ADMIN_CONFIG['player.volume']))) : Store.volume,
                theme: typeof TVP_ADMIN_CONFIG['player.theme'] === 'string' ? TVP_ADMIN_CONFIG['player.theme'] : undefined,
                autoplay: TVP_ADMIN_CONFIG['player.autoplay'] !== false,
                pip: TVP_ADMIN_CONFIG['player.pip'] !== false,
                screenshot: TVP_ADMIN_CONFIG['player.screenshot'] !== false,
                playbackRate: TVP_ADMIN_CONFIG['player.playbackRate'] !== false,
                aspectRatio: TVP_ADMIN_CONFIG['player.aspectRatio'] !== false,
                resume
            });
            if (ok) {
                // Hooks: timeupdate guarda progreso, ended pasa al siguiente,
                // error -> _onInsideError (salta a motor avanzado si procede),
                // volumechange persiste volumen.
                window.ArtBridge.on('timeupdate', () => this._tickArt());
                window.ArtBridge.on('ended', () => { Store.clearProgress(playable.id); this.maybeNext(playable, parent); });
                window.ArtBridge.on('error', () => this._onInsideError(playable, parent));
                window.ArtBridge.on('volumechange', () => { try { Store.volume = window.ArtBridge.volume; } catch {} });
                return;
            }
        }

        // Fallback: <video> nativo
        el.playerVideo.hidden = false;
        const v = el.playerVideo;
        v.src = url;
        try { v.volume = Store.volume; } catch {}
        v.onloadedmetadata = () => { if (resume > 8 && resume < v.duration - 5) v.currentTime = resume; };
        v.onerror = () => { this._onInsideError(playable, parent); };
        v.ontimeupdate = () => this._tick();
        v.onvolumechange = () => { Store.volume = v.volume; };
        v.onended = () => { Store.clearProgress(playable.id); this.maybeNext(playable, parent); };
        v.play().catch(() => {});
    },

    // Forzar reproducción interna aunque el formato no esté marcado como compatible.
    // A veces el navegador SÍ reproduce un mkv si el codec interior es H.264/AAC.
    _forceInternal() {
        if (!this.current || !this.current.playable) return;
        this._playInside(this.current.playable, this.current.parent);
    },

    // Botón "▶ Reproducir aquí": intenta nativo/Artplayer y, si el formato no es
    // compatible (error), salta AUTOMÁTICAMENTE al motor avanzado (FFmpeg.wasm)
    // que remuxea sobre la marcha. Asi el usuario tiene UN solo botón de Play.
    _playHere() {
        if (!this.current || !this.current.playable) return;
        this._autoAdvanced = true; // si el intento nativo falla, usar motor avanzado
        this._playInside(this.current.playable, this.current.parent);
    },

    // Manejo de error al reproducir dentro: si venimos de "_playHere" saltamos al
    // motor avanzado; si no, mostramos el menú de reproductores externos.
    _onInsideError(playable, parent) {
        if (this._autoAdvanced) {
            this._autoAdvanced = false;
            if (window.MkvPlayer) { try { window.MkvPlayer.play(playable); return; } catch (e) {} }
        }
        this._openExternal(absUrl(playable.streamUrl), playable);
    },

    // Abre el enlace tvgram:// en la app TVGram Player. En Android usa un intent
    // explícito (abre la app o, si no está, ofrece descargarla); en el resto de
    // plataformas navega al esquema tvgram:// directamente (el SO enruta a la app).
    _openTvgram(url, playable) {
        el.detailHero.classList.remove('playing');
        if (window.ArtBridge && !window.ArtBridge.hidden) { try { window.ArtBridge.destroy(); } catch {} }
        try { el.playerVideo.pause(); } catch {}
        el.playerVideo.hidden = true; el.playerVideo.removeAttribute('src');
        el.playerIframe.hidden = true; el.playerIframe.src = '';
        el.detailBackdrop.hidden = false;
        // Mostrar el panel de opciones (con botón destacado "Abrir en TVGram Player")
        ExternalPlayers.renderTvgram(url, playable);
        // Intentar abrir directamente
        try { window.location.href = ExternalPlayers.tvgramHref(url); } catch (e) {}
    },

    // Construye la referencia {kind,a,b} del mensaje a partir del streamUrl,
    // para pasarla al reproductor nativo de la APK (ExoPlayer).
    _streamRef(playable) {
        const su = (playable && playable.streamUrl) || '';
        const m = su.match(/^(tgstream|tgstreamlink)\/([^/]+)\/([^/?#]+)/);
        if (!m) return null;
        let group = '';
        try { group = new URL(su, location.href).searchParams.get('group') || ''; } catch {}
        return JSON.stringify({ kind: m[1], a: m[2], b: m[3], group });
    },
    // ¿Está disponible el reproductor nativo de la APK Android?
    _hasNative() {
        try { return !!(window.NativeHost && NativeHost.isAvailable && NativeHost.isAvailable()); }
        catch (e) { return false; }
    },
    // Lanza el reproductor nativo (ExoPlayer/libVLC) con el vídeo de Telegram.
    _playNative(playable, parent) {
        const ref = this._streamRef(playable);
        if (!ref) return false;
        try {
            const title = (parent && parent.title) || playable.title || '';
            const ext = (playable.ext || '').toLowerCase();
            const mime = playable.mime || (ext ? 'video/' + ext : '');
            // MKV -> libVLC (audio AC3/DTS que ExoPlayer no decodifica); AVI/WMV/etc
            // tambien libVLC. El resto (mp4/webm/mov) -> ExoPlayer (HW, ligero).
            // SOLO los formatos claramente compatibles con ExoPlayer van a ExoPlayer.
            // Todo lo demas (MKV, AVI, TS, desconocido...) va a libVLC, que SIEMPRE
            // saca el audio (AC3/EAC3/DTS incluidos). Asi el MKV se escucha.
            const exoExt = ['mp4', 'm4v', 'webm', 'mov'];
            const engine = exoExt.indexOf(ext) >= 0 ? 'exo' : 'vlc';
            NativeHost.play(ref, title, mime, engine);
            return true;
        } catch (e) { return false; }
    },

    // "Abrir con..." nativo: selector del sistema para elegir reproductor.
    _openWithNative(playable, parent) {
        const ref = this._streamRef(playable);
        if (!ref) return false;
        try {
            const title = (parent && parent.title) || playable.title || '';
            const ext = (playable.ext || '').toLowerCase();
            const mime = playable.mime || (ext ? 'video/' + ext : 'video/*');
            NativeHost.openWith(ref, title, mime);
            return true;
        } catch (e) { return false; }
    },

    // Abre el video con el reproductor externo del usuario (VLC/AceStream/etc.)
    _openExternal(url, playable) {
        el.detailHero.classList.remove('playing');
        // Detener Artplayer si estaba activo
        if (window.ArtBridge && !window.ArtBridge.hidden) { try { window.ArtBridge.destroy(); } catch {} }
        try { el.playerVideo.pause(); } catch {}
        el.playerVideo.hidden = true; el.playerVideo.removeAttribute('src');
        el.playerIframe.hidden = true; el.playerIframe.src = '';
        el.detailBackdrop.hidden = false;
        const isAce = /^acestream:\/\//i.test(url);
        const isTg = /\/api\/stream\//.test(url);
        const ext = (playable && playable.ext || '').toUpperCase();
        // Para acestream y mkv/avi: intentamos abrir directo en el reproductor instalado
        try {
            if (isAce) {
                // Intentar abrir AceStream sin recargar la pestaña
                window.location.href = url;
            } else {
                // VLC/m3u/etc: intent en Android, fallback a abrir en pestaña
                const ua = navigator.userAgent || '';
                if (/Android/i.test(ua)) {
                    window.location.href = 'intent:' + url + '#Intent;type=video/*;action=android.intent.action.VIEW;end';
                } else {
                    window.open(url, '_blank');
                }
            }
        } catch {}
        // Mostrar opciones por si el primer intento no abre nada
        ExternalPlayers.renderForUrl(url, playable, { isAce, isTg, ext });
    },

    _showError(msg, playable) {
        el.detailHero.classList.remove('playing'); el.detailBackdrop.hidden = false;
        el.playerStatus.hidden = false; el.playerStatus.innerText = msg;
        if (playable) ExternalPlayers.render(playable);
    },

    maybeNext(playable, parent) {
        if (!parent || !parent.episodes || parent.episodes.length < 2) return;
        const i = parent.episodes.findIndex(e => String(e.id) === String(playable.id));
        if (i < 0 || i >= parent.episodes.length - 1) return;
        const next = parent.episodes[i + 1];
        if (Detail && Detail.current === parent) { Detail.primary = next; }
        if (typeof ExternalPlayers !== 'undefined') ExternalPlayers.render(next);
        this.play(next, parent);
    },

    _lastSave: 0,
    _tick() {
        this._autoAdvanced = false; // ya reproduce bien: no saltar a avanzado
        const v = el.playerVideo, c = this.current;
        if (!c || !v.duration) return;
        const now = Date.now();
        if (now - this._lastSave > 5000) { this._lastSave = now; Store.saveProgress(c.playable, c.parent, v.currentTime, v.duration); CloudStore.saveProgress(); }
    },
    // Igual que _tick pero leyendo el tiempo desde Artplayer (cuando esta activo)
    _tickArt() {
        this._autoAdvanced = false; // ya reproduce bien: no saltar a avanzado
        const c = this.current;
        if (!c || !window.ArtBridge || !window.ArtBridge.duration) return;
        const now = Date.now();
        if (now - this._lastSave > 5000) {
            this._lastSave = now;
            Store.saveProgress(c.playable, c.parent, window.ArtBridge.currentTime, window.ArtBridge.duration);
            CloudStore.saveProgress();
        }
    },
    flushProgress() {
        const c = this.current;
        if (!c) return;
        // Si Artplayer esta activo, usar su tiempo
        if (window.ArtBridge && !window.ArtBridge.hidden && window.ArtBridge.duration) {
            const t = window.ArtBridge.currentTime;
            if (t > 8) Store.saveProgress(c.playable, c.parent, t, window.ArtBridge.duration);
            return;
        }
        const v = el.playerVideo;
        if (!v.hidden && v.currentTime > 8 && v.duration) Store.saveProgress(c.playable, c.parent, v.currentTime, v.duration);
    },

    embed(url) {
        try {
            const u = new URL(url);
            if (u.hostname.includes('youtu')) {
                const id = u.searchParams.get('v') || u.pathname.split('/').pop();
                return `https://www.youtube.com/embed/${id}`;
            }
        } catch {}
        return url;
    }
};

/* ===== LOGIN por usuario ===== */
const Login = {
    loginId: null,
    open() {
        el.loginModal.hidden = false;
        document.body.style.overflow = 'hidden';
        this.step('phone');
        this.msg('');
        this.start();
    },
    async start() {
        try { const r = await api('/api/login/start', { method: 'POST', body: '{}' }); this.loginId = r.loginId; }
        catch (e) { this.msg('No se pudo iniciar el acceso: ' + e.message); }
    },
    step(s) { $$('#login-modal .login-step').forEach(x => x.hidden = x.dataset.step !== s); },
    msg(t) { const n = document.getElementById('login-status'); if (n) n.innerText = t || ''; },
    async sendCode() {
        const phone = $('#login-phone').value.trim();
        if (!phone) return this.msg('Escribe tu número con prefijo (ej: +34...).');
        if (!this.loginId) await this.start();
        this.msg('Enviando código...');
        try {
            await api('/api/login/send-code', { method: 'POST', body: JSON.stringify({ loginId: this.loginId, phone }) });
            this.msg('Código enviado. Míralo en tu app de Telegram.');
            this.step('code'); $('#login-code').focus();
        } catch (e) { this.msg(e.message); }
    },
    async verifyCode() {
        const code = $('#login-code').value.trim();
        if (!code) return this.msg('Escribe el código.');
        this.msg('Verificando...');
        try {
            const r = await api('/api/login/sign-in', { method: 'POST', body: JSON.stringify({ loginId: this.loginId, code }) });
            if (r.needPassword) { this.msg('Tu cuenta tiene verificación en dos pasos.'); this.step('password'); $('#login-password').focus(); }
            else { if (r.token) try { localStorage.setItem('tvp_token', r.token); } catch {} ; location.reload(); }
        } catch (e) { this.msg(e.message); }
    },
    async verifyPassword() {
        const password = $('#login-password').value;
        if (!password) return this.msg('Escribe tu contraseña 2FA.');
        this.msg('Comprobando...');
        try { const r = await api('/api/login/password', { method: 'POST', body: JSON.stringify({ loginId: this.loginId, password }) }); if (r.token) try { localStorage.setItem('tvp_token', r.token); } catch {} ; location.reload(); }
        catch (e) { this.msg(e.message); }
    }
};

/* ===== Cierre de sesión ===== */
const Logout = {
    async logout() {
        if (!confirm('¿Cerrar tu sesión de Telegram en esta web?')) return;
        try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {}
        try { localStorage.removeItem('tvp_token'); } catch {}
        location.reload();
    }
};

const Voice = {
    rec: null,
    supported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
    init() {
        const btn = $('#voice-search');
        if (!btn || !this.supported()) return;
        btn.hidden = false;
        btn.onclick = () => this.toggle();
    },
    toggle() {
        const btn = $('#voice-search');
        if (this.rec) { try { this.rec.stop(); } catch {} return; }
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const rec = new SR();
        this.rec = rec;
        rec.lang = 'es-ES'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
        if (btn) btn.classList.add('listening');
        rec.onresult = (e) => {
            let txt = '';
            for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
            if (el.searchInput) { el.searchInput.value = txt; App.search(); }
        };
        const end = () => { this.rec = null; if (btn) btn.classList.remove('listening'); };
        rec.onerror = end; rec.onend = end;
        try { rec.start(); } catch { end(); }
    }
};

/* ===== Navegación con mando de TV Box (flechas + OK + atrás) ===== */
const TVNav = {
    SEL: '.card, .card-remove, .btn, .episode, .opt-btn, .source-btn, .filter-select, .nav-links a, .icon-btn, .search-btn, .search-voice, .slider-arrow, .search-card, #search-input, .groups-search, .group-open, .group-favorite, .modal-close',
    refresh() { $$(this.SEL).forEach(e => { if (e.tabIndex < 0) e.tabIndex = 0; }); },
    scope() {
        if (!el.playerModal.hidden) return el.playerModal;
        if (!el.searchOverlay.hidden) return el.searchOverlay;
        return document;
    },
    focusables() {
        const root = this.scope();
        return $$(this.SEL, root === document ? document : root)
            .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.disabled; });
    },
    move(dir) {
        const list = this.focusables();
        if (!list.length) return;
        const cur = document.activeElement;
        if (!cur || !list.includes(cur)) { list[0].focus(); return; }
        const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let best = null, score = Infinity;
        for (const e of list) {
            if (e === cur) continue;
            const b = e.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
            const dx = bx - cx, dy = by - cy;
            let ok, primary, secondary;
            if (dir === 'right') { ok = dx > 8; primary = dx; secondary = Math.abs(dy); }
            else if (dir === 'left') { ok = dx < -8; primary = -dx; secondary = Math.abs(dy); }
            else if (dir === 'down') { ok = dy > 8; primary = dy; secondary = Math.abs(dx); }
            else { ok = dy < -8; primary = -dy; secondary = Math.abs(dx); }
            if (!ok) continue;
            const s = primary + secondary * 2.2;
            if (s < score) { score = s; best = e; }
        }
        if (best) { best.focus(); best.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }
    },
    // Normaliza la direccion desde cualquier mando: e.key moderno (ArrowX),
    // e.key antiguo (Up/Down/Left/Right), o e.keyCode (37-40). Algunos TV-box
    // solo mandan uno de los tres.
    _dir(e) {
        const k = e.key, c = e.keyCode || e.which;
        if (k === 'ArrowUp' || k === 'Up' || c === 38) return 'up';
        if (k === 'ArrowDown' || k === 'Down' || c === 40) return 'down';
        if (k === 'ArrowLeft' || k === 'Left' || c === 37) return 'left';
        if (k === 'ArrowRight' || k === 'Right' || c === 39) return 'right';
        return null;
    },
    _isEnter(e) {
        const k = e.key, c = e.keyCode || e.which;
        // 13=Enter, 23=DPAD_CENTER (algunos WebView), 'Select'/'Enter'
        return k === 'Enter' || k === 'Select' || k === 'OK' || c === 13 || c === 23;
    },
    _isBack(e) {
        const k = e.key, c = e.keyCode || e.which;
        // 8=Backspace, 10009=Tizen back, 461=algunos TV, 27=Esc
        return k === 'Backspace' || k === 'GoBack' || k === 'BrowserBack' || c === 8 || c === 10009 || c === 461;
    },
    init() {
        // capture:true -> interceptamos ANTES de que el WebView consuma la tecla
        document.addEventListener('keydown', (e) => {
            const ae = document.activeElement;
            const inField = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
            const dir = this._dir(e);
            if (dir) {
                // Si Artplayer (navegador) está reproduciendo, que gestione él el
                // seek con izq/der; no robamos las flechas.
                if (window.ArtBridge && !window.ArtBridge.hidden) return;
                // En campos de texto dejamos mover el cursor con izq/der
                if (inField && (dir === 'left' || dir === 'right')) return;
                e.preventDefault();
                e.stopPropagation();
                this.move(dir);
                return;
            }
            if (this._isEnter(e)) {
                if (ae && !inField && ae.click) { e.preventDefault(); e.stopPropagation(); ae.click(); }
                return;
            }
            if (this._isBack(e)) {
                if (inField) return;
                if (!el.playerModal.hidden) { e.preventDefault(); Detail.close(); }
                else if (!el.searchOverlay.hidden) { e.preventDefault(); App.closeSearch(); }
            }
        }, { capture: true });
    }
};

/* ===== ARRANQUE ===== */
// Llamado por la APK Android al pulsar ATRAS: cierra el modal/panel abierto y
// devuelve true si manejó la accion; si no, la app hara back/salir.
window.TVPlus_onBack = function () {
    try {
        if (el.searchOverlay && !el.searchOverlay.hidden) { App.closeSearch(); return true; }
        if (el.playerModal && !el.playerModal.hidden) { Detail.close(); return true; }
    } catch (e) {}
    return false;
};
// ESC tambien cierra el overlay/modal de encima (teclado / navegador)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (window.TVPlus_onBack()) { e.preventDefault(); e.stopPropagation(); } }
}, { capture: true });

let groupLoadVersion = 0;

function applyCatalog(catalog, groupId) {
    state.catalog = catalog || { categories: [] };
    state.allItems = [];
    state.itemsById = {};
    (state.catalog.categories || []).forEach(category => (category.items || []).forEach(item => {
        applyAdminItemOverride(item, groupId, item.topicId || category.id);
        (item.episodes || []).forEach(episode => applyAdminItemOverride(episode, groupId, episode.topicId || item.topicId || category.id));
        item.category = category.name;
        state.allItems.push(item);
        state.itemsById[item.id] = item;
    }));
    try {
        sessionStorage.setItem('tvp_catalog:' + encodeURIComponent(groupId), JSON.stringify({
            ts: Date.now(), data: state.catalog
        }));
    } catch {}
    App.populateFilters();
    Netflix.render();
}

async function loadGroupCatalog(groupId, useCache) {
    const selectedGroup = String(groupId || '').trim();
    if (!selectedGroup) throw new Error('Selecciona un grupo de Telegram.');
    const requestId = ++groupLoadVersion;
    state.activeGroup = selectedGroup;
    await loadAdminRuntime(selectedGroup);
    try { localStorage.setItem(state.groupPreferenceKey, selectedGroup); } catch {}

    const endpoint = '/api/catalog?group=' + encodeURIComponent(selectedGroup);
    const cacheKey = 'tvp_catalog:' + encodeURIComponent(selectedGroup);
    let cached = null;
    if (useCache) {
        try { cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null'); } catch {}
    }
    const refresh = async () => {
        const catalog = await api(endpoint + '&refresh=1');
        if (requestId === groupLoadVersion && state.activeGroup === selectedGroup) {
            applyCatalog(catalog, selectedGroup);
        }
    };
    if (cached && cached.data && cached.ts && Date.now() - cached.ts < 30 * 60 * 1000) {
        applyCatalog(cached.data, selectedGroup);
        refresh().catch(e => console.warn('No se pudo actualizar el catálogo del grupo:', e.message));
        return;
    }

    el.rowsContainer.innerHTML = '<div class="empty-state">Cargando grupo…</div>';
    const fastCatalog = await api(endpoint + '&fast=1');
    if (requestId !== groupLoadVersion) return;
    applyCatalog(fastCatalog, selectedGroup);
    setTimeout(() => refresh().catch(e => console.warn('No se pudo completar el catálogo del grupo:', e.message)), 200);
}

function groupPreferenceKey(me, kind) {
    const identity = me.userId || me.username || me.name || 'account';
    return `tvp_${kind}_group:${encodeURIComponent(String(identity).toLowerCase())}`;
}

function renderGroupsList(query) {
    const list = $('#groups-list');
    if (!list) return;
    query = String(query || '').trim().toLocaleLowerCase();
    const favoriteIds = new Set(state.favoriteGroups);
    const choices = state.groups.slice().sort((a, b) => {
        const favoriteOrder = Number(favoriteIds.has(b.peerId)) - Number(favoriteIds.has(a.peerId));
        if (favoriteOrder) return favoriteOrder;
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    }).filter(group => !query || [group.title, group.username, group.subtitle, group.peerId]
        .some(value => String(value || '').toLocaleLowerCase().includes(query)));
    list.innerHTML = choices.map(group => {
        const title = escapeHtml(group.title);
        const type = group.isChannel ? 'Canal' : 'Grupo';
        const isFavorite = favoriteIds.has(group.peerId);
        const isCurrent = group.peerId === state.activeGroup;
        const meta = [type, group.username ? '@' + escapeHtml(group.username) : '', isCurrent ? 'Grupo actual' : ''].filter(Boolean).join(' · ');
        return `<article class="group-row${isCurrent ? ' current' : ''}">
            <button type="button" class="group-open" data-group-id="${escapeHtml(group.peerId)}" aria-label="Abrir ${title}">
                <span class="group-name">${isFavorite ? '★ ' : ''}${title}</span>
                <span class="group-meta">${meta}</span>
            </button>
            <button type="button" class="group-favorite" data-group-id="${escapeHtml(group.peerId)}" aria-pressed="${isFavorite}" aria-label="${isFavorite ? 'Quitar' : 'Añadir'} ${title} ${isFavorite ? 'de' : 'a'} favoritos">${isFavorite ? '★' : '☆'}</button>
        </article>`;
    }).join('') || '<div class="empty-state">No se encontraron grupos.</div>';
    $$('.group-open', list).forEach(button => button.onclick = () => {
        const groupId = button.dataset.groupId;
        loadGroupCatalog(groupId, false).catch(e => {
            if (state.activeGroup !== groupId) return;
            el.rowsContainer.innerHTML = `<div class="empty-state">No se pudo cargar el grupo.<br>${escapeHtml(e.message)}</div>`;
        });
    });
    $$('.group-favorite', list).forEach(button => button.onclick = () => {
        const groupId = button.dataset.groupId;
        toggleFavoriteGroup(groupId, query);
        const focusTarget = $$('.group-favorite', list).find(item => item.dataset.groupId === groupId);
        if (focusTarget) focusTarget.focus();
    });
    TVNav.refresh();
}

function renderGroupsPage() {
    el.rowsContainer.innerHTML = `<section class="groups-page">
        <header class="groups-page-header">
            <div><h1 class="groups-page-title">Grupos</h1><p class="groups-page-description">Busca tus grupos y marca favoritos para tenerlos arriba.</p></div>
            <input id="groups-search" class="groups-search" type="search" placeholder="Buscar grupos..." aria-label="Buscar grupos">
        </header>
        <div id="groups-list" class="groups-list"></div>
    </section>`;
    const search = $('#groups-search');
    search.oninput = () => renderGroupsList(search.value);
    renderGroupsList('');
}

function openGroupsPage() {
    $$('#nav-links a').forEach(link => link.classList.toggle('active', link.dataset.cat === '__groups'));
    renderGroupsPage();
}

function setCatalogGroups(groups, me) {
    const configuredId = String((window.TVP_CONFIG && window.TVP_CONFIG.groupId) || '').trim();
    const seenGroups = new Set();
    const choices = (groups || []).filter(group => {
        if (!group || group.peerId == null || (!group.isGroup && !group.isChannel)) return false;
        const id = String(group.peerId);
        if (seenGroups.has(id)) return false;
        seenGroups.add(id);
        return true;
    }).map(group => Object.assign({}, group, {
        peerId: String(group.peerId),
        title: String(group.title || 'Sin nombre')
    }));
    state.account = me;
    state.groupPreferenceKey = groupPreferenceKey(me, 'selected');
    state.groups = choices;
    if (el.groupsTabBtn) el.groupsTabBtn.hidden = !choices.length;
    const configuredUsername = configuredId.replace(/^@/, '').toLowerCase();
    let selected = '', favorites = [];
    try {
        selected = localStorage.getItem(state.groupPreferenceKey) || localStorage.getItem('tvp_selected_group') || '';
        const savedFavorites = localStorage.getItem(groupPreferenceKey(me, 'favorite')) || '';
        if (savedFavorites) {
            try {
                const parsed = JSON.parse(savedFavorites);
                favorites = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
            } catch { favorites = [savedFavorites]; }
        }
    } catch {}
    state.favoriteGroups = [...new Set(favorites)];
    let chosen = choices.find(group => state.favoriteGroups.includes(group.peerId));
    if (!chosen) chosen = choices.find(group => group.peerId === selected);
    if (!chosen) chosen = choices.find(group =>
        group.peerId === configuredId || (group.username || '').toLowerCase() === configuredUsername
    );
    if (!chosen) chosen = choices[0];
    return chosen ? chosen.peerId : '';
}

function toggleFavoriteGroup(groupId, query) {
    if (!groupId || !state.account) return;
    state.favoriteGroups = state.favoriteGroups.includes(groupId)
        ? state.favoriteGroups.filter(id => id !== groupId)
        : state.favoriteGroups.concat(groupId);
    try {
        const key = groupPreferenceKey(state.account, 'favorite');
        if (state.favoriteGroups.length) localStorage.setItem(key, JSON.stringify(state.favoriteGroups));
        else localStorage.removeItem(key);
    } catch {}
    renderGroupsList(query);
}

async function boot() {
    try {
        const info = await api('/api/app').catch(() => null);
        if (info && info.appName) { if (el.brand) el.brand.innerText = info.appName.toUpperCase(); document.title = info.appName; }

        const me = await api('/api/me').catch(() => ({ loggedIn: false }));
        if (!me.loggedIn) { el.loadingScreen.classList.add('hidden'); Login.open(); return; }
        let groupList;
        try {
            groupList = await api('/api/groups');
        } catch (e) {
            throw new Error('No se pudieron comprobar los grupos con la etiqueta configurada: ' + e.message);
        }
        const selectedGroup = setCatalogGroups(groupList.groups, me);
        if (!selectedGroup) {
            el.rowsContainer.innerHTML = `<div class="empty-state">No se encontraron grupos o canales con temas que contengan la etiqueta configurada para <b>${escapeHtml(me.name || '')}</b>.</div>`;
            return;
        }

        // Sincronizar en segundo plano para que la nube no bloquee el catálogo.
        CloudStore.init(me.name || 'user');
        Promise.all([
            CloudStore.syncFavs(),
            CloudStore.syncProgress(),
            CloudStore.syncWatched()
        ]).then(() => {
            const activeLink = $('#nav-links a.active');
            if (state.activeGroup === selectedGroup && activeLink && !activeLink.dataset.cat && !$('#groups-list')) {
                Netflix.render();
            }
        }).catch(e => console.warn('No se pudo sincronizar los datos en la nube:', e.message));

        el.loadingText.innerText = 'Cargando catálogo...';
        await loadGroupCatalog(selectedGroup, true);
        setTimeout(() => { const f = $('.card'); if (f) f.focus(); }, 200);
    } catch (e) {
        console.error(e);
        el.rowsContainer.innerHTML = `<div class="empty-state">No se pudo cargar el contenido.<br>${escapeHtml(e.message)}</div>`;
    } finally {
        el.loadingScreen.classList.add('hidden');
    }
}

function wireUi() {
    el.logoutBtn.onclick = () => Logout.logout();
    $('#btn-send-code').onclick = () => Login.sendCode();
    $('#btn-verify-code').onclick = () => Login.verifyCode();
    $('#btn-verify-password').onclick = () => Login.verifyPassword();
    $('#btn-back-phone').onclick = () => Login.step('phone');
    $('#login-phone').addEventListener('keydown', e => { if (e.key === 'Enter') Login.sendCode(); });
    $('#login-code').addEventListener('keydown', e => { if (e.key === 'Enter') Login.verifyCode(); });
    $('#login-password').addEventListener('keydown', e => { if (e.key === 'Enter') Login.verifyPassword(); });
    $('.modal-close', el.playerModal).onclick = () => Detail.close();
    if (el.playerExit) el.playerExit.onclick = () => Detail.close();
    $('.modal-overlay', el.playerModal).onclick = () => Detail.close();
    el.searchBtn.onclick = () => App.openSearch();
    $('.search-close', el.searchOverlay).onclick = () => App.closeSearch();
    el.searchInput.addEventListener('input', () => App.search());
    Voice.init();
    el.filterGenre.addEventListener('change', () => App.search());
    el.filterYear.addEventListener('change', () => App.search());
    if (el.filterQuality) el.filterQuality.addEventListener('change', () => App.search());
    if (el.filterLang) el.filterLang.addEventListener('change', () => App.search());
    if (el.filterCat) el.filterCat.addEventListener('change', () => App.search());
    if (el.groupsTabBtn) el.groupsTabBtn.onclick = openGroupsPage;
    el.navLinks.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-cat]'); if (!a) return;
        e.preventDefault();
        $$('#nav-links a').forEach(x => x.classList.remove('active'));
        a.classList.add('active');
        if (a.dataset.cat === '__groups') { openGroupsPage(); return; }
        if (!a.dataset.cat) { Netflix.render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
        Netflix.renderCategory(a.dataset.cat);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!el.searchOverlay.hidden) App.closeSearch();
        else if (!el.playerModal.hidden) Detail.close();
    });
    if (el.trailerMute) el.trailerMute.onclick = () => Detail.toggleTrailerSound();

    // Atajos de teclado del reproductor (cuando se usa el <video> nativo).
    // Si Artplayer esta activo, el ya gestiona sus atajos (hotkey: true).
    document.addEventListener('keydown', (e) => {
        if (el.playerModal.hidden) return;
        // Cinema mode siempre disponible
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (e.key.toLowerCase() === 'c') { e.preventDefault(); el.body.classList.toggle('cinema-mode'); return; }
        // Si Artplayer esta activo, dejar que sus hotkeys funcionen
        if (window.ArtBridge && !window.ArtBridge.hidden) return;
        const v = el.playerVideo;
        if (v.hidden) return;
        const k = e.key.toLowerCase();
        if (k === ' ' || k === 'k') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); v.currentTime = Math.min((v.currentTime || 0) + 10, v.duration || Infinity); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); v.currentTime = Math.max((v.currentTime || 0) - 10, 0); }
        else if (k === 'f') { e.preventDefault(); if (document.fullscreenElement) document.exitFullscreen(); else v.requestFullscreen && v.requestFullscreen(); }
        else if (k === 'm') { e.preventDefault(); v.muted = !v.muted; }
    });
    window.addEventListener('scroll', () => { el.navbar.classList.toggle('scrolled', window.scrollY > 50); });
    TVNav.init();
}

document.addEventListener('DOMContentLoaded', () => { wireUi(); boot(); });
