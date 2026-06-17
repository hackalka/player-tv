/* =====================================================================
 * Tv Player — frontend
 *  - Catálogo Netflix (películas/series/deportes) desde la API
 *  - Continuar viendo + Mi lista (favoritos) en localStorage
 *  - Reproductores externos (VLC / AceStream) para mkv/avi/enlaces
 *  - Chat solo para administradores (editar / borrar)
 *  - Navegación con mando de TV Box (flechas + OK + atrás)
 * ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const PLACEHOLDER_COLORS = ['#3a1c71', '#b21f1f', '#1a2a6c', '#4b6cb7', '#182848', '#0f2027', '#572d2d', '#2c3e50'];
function placeholderImage(seed, label) {
    const color = PLACEHOLDER_COLORS[Math.abs(hashCode(String(seed))) % PLACEHOLDER_COLORS.length];
    const txt = (label || 'TV').slice(0, 16);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='600'><rect width='100%' height='100%' fill='${color}'/><text x='50%' y='50%' fill='rgba(255,255,255,.85)' font-family='Arial' font-size='26' font-weight='bold' text-anchor='middle' dominant-baseline='middle'>${escapeXml(txt)}</text></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h; }
function escapeXml(s) { return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])); }
function escapeHtml(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
function fmtTime(d) { try { return new Date(d * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
function absUrl(p) { return p ? new URL(p, location.href).href : ''; }

async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    // Fallback de auth: si guardamos un token en localStorage, lo enviamos como header
    try { const t = localStorage.getItem('tvp_token'); if (t) headers['x-auth-token'] = t; } catch {}
    const r = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('Error ' + r.status));
    return data;
}

/* ===== Almacenamiento local (progreso / favoritos / admin) ===== */
const Store = {
    _get(k, def) { try { return JSON.parse(localStorage.getItem(k)) || def; } catch { return def; } },
    _set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    get progress() { return this._get('tvp_progress', {}); },
    set progress(v) { this._set('tvp_progress', v); },
    get favs() { return this._get('tvp_favs', {}); },
    set favs(v) { this._set('tvp_favs', v); },
    get lastEp() { return this._get('tvp_lastep', {}); },
    set lastEp(v) { this._set('tvp_lastep', v); },
    get adminKey() { try { return localStorage.getItem('tvp_admin') || ''; } catch { return ''; } },
    set adminKey(v) { try { v ? localStorage.setItem('tvp_admin', v) : localStorage.removeItem('tvp_admin'); } catch {} },

    saveProgress(playable, parent, time, duration) {
        if (!playable || !playable.id || !time || time < 8) return;
        const p = this.progress;
        p[playable.id] = {
            id: playable.id, title: (parent && parent.title) || playable.title || 'Video',
            epTitle: playable.title || '', thumbUrl: playable.thumbUrl || (parent && parent.thumbUrl) || '',
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
    // Carátulas personalizadas (override por admin cuando TMDB no acierta)
    get covers() { return this._get('tvp_covers', {}); },
    set covers(v) { this._set('tvp_covers', v); },
    setCover(id, url) { const c = this.covers; if (url) c[id] = url; else delete c[id]; this.covers = c; },
    getCover(id) { return this.covers[id] || ''; },
};

/* ===== Firebase Firestore (favoritos + continuar viendo en la nube) ===== */
const CloudStore = {
    db: null, uid: null,
    init(userId) {
        try {
            if (!window.firebase || !window.firebase.firestore) return;
            if (!firebase.apps.length) {
                firebase.initializeApp({ apiKey: 'AIzaSyDummy', projectId: 'playertv-9449c' });
            }
            this.db = firebase.firestore();
            this.uid = String(userId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '');
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
    // Carátulas personalizadas (admin) — compartidas para todos los usuarios
    async syncCovers() {
        if (!this.db) return;
        try {
            const doc = await this.db.collection('shared').doc('covers').get();
            if (doc.exists && doc.data().covers) Store.covers = Object.assign({}, doc.data().covers, Store.covers);
        } catch {}
    },
    async saveCovers() { if (!this.db) return; try { await this.db.collection('shared').doc('covers').set({ covers: Store.covers }, { merge: true }); } catch {} }
};

const state = { catalog: { categories: [] }, allItems: [], itemsById: {}, topics: [], chatCache: {}, activeTopic: null, isAdmin: false, adminEnabled: false };

const el = {
    body: document.body,
    brand: $('#brand-name'),
    netflixView: $('#netflix-view'),
    telegramView: $('#telegram-view'),
    navbar: $('.navbar'),
    navNetflix: $('#nav-netflix'),
    navTelegram: $('#nav-telegram'),
    viewSwitch: $('.view-switch'),
    navLinks: $('#nav-links'),
    adminLock: $('#admin-lock'),
    adminRefresh: $('#admin-refresh'),
    filterGenre: $('#filter-genre'),
    filterYear: $('#filter-year'),
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
    playerStatus: $('#player-status'),
    detailHero: $('#detail-hero'),
    detailBackdrop: $('#detail-backdrop'),
    detailPoster: $('#detail-poster'),
    detailGenres: $('#detail-genres'),
    modalRating: $('#modal-rating'),
    detailPlay: $('#detail-play'),
    favBtn: $('#fav-btn'),
    watchedBtn: $('#watched-btn'),
    coverBtn: $('#cover-btn'),
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
    chatList: $('#chat-list'),
    chatMessages: $('#chat-messages'),
    chatHeaderTitle: $('#chat-header-title'),
    chatHeaderMeta: $('#chat-header-meta'),
    loadingScreen: $('#loading-screen'),
    loadingText: $('#loading-text'),
    loginModal: $('#login-modal')
};

/* ===== NETFLIX ===== */
const Netflix = {
    render() {
        el.rowsContainer.innerHTML = '';
        const cats = state.catalog.categories.filter(c => c.items && c.items.length);

        el.navLinks.innerHTML = '<li><a href="#" class="active" data-cat="">Inicio</a></li>' +
            cats.map(c => `<li><a href="#" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)}</a></li>`).join('');

        // Filas dinámicas: Continuar viendo + Mi lista + categorías
        const cont = Store.continueList();
        if (cont.length) el.rowsContainer.appendChild(this.row('▶ Continuar viendo', cont, 'continue'));
        const favs = Store.favList();
        if (favs.length) el.rowsContainer.appendChild(this.row('❤ Mi lista', favs));

        const novedades = state.allItems.filter(it => it.date).sort((a, b) => b.date - a.date).slice(0, 18);
        if (novedades.length) el.rowsContainer.appendChild(this.row('Novedades', novedades));

        const top = state.allItems.filter(it => it.meta && parseFloat(it.meta.rating) > 0)
            .sort((a, b) => parseFloat(b.meta.rating) - parseFloat(a.meta.rating)).slice(0, 10);
        top.forEach((it, i) => it._rank = i + 1);
        if (top.length) el.rowsContainer.appendChild(this.row('🔥 Top 10', top, 'top'));

        if (!cats.length && !cont.length && !favs.length) {
            el.rowsContainer.innerHTML = `<div class="empty-state">No se encontró contenido en los temas con la etiqueta configurada.</div>`;
            return;
        }
        let heroPool = [];
        cats.forEach(c => {
            heroPool = heroPool.concat(c.items.slice(0, 5));
            el.rowsContainer.appendChild(this.row(`${c.icon || ''} ${c.name}`, c.items));
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
        if (!cat || !cat.items.length) { el.rowsContainer.innerHTML = '<div class="empty-state">Sin contenido en ' + escapeHtml(name) + '.</div>'; return; }
        // Fila "Todas" + una fila por cada género
        el.rowsContainer.appendChild(this.row(`${cat.icon || ''} Todas`, cat.items));
        const byGenre = {};
        cat.items.forEach(it => {
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
        card.tabIndex = 0;
        const img = Store.getCover(item.id) || item.thumbUrl || placeholderImage(item.id, item.title || item.epTitle);
        const pct = (kind === 'continue' && item.duration) ? Math.min(100, Math.round(item.time / item.duration * 100)) : 0;
        card.innerHTML = `
            ${kind === 'top' && item._rank ? `<div class="card-rank">${item._rank}</div>` : ''}
            <img class="card-image" src="${img}" alt="${escapeHtml(item.title || '')}" loading="lazy"
                 onerror="this.src='${placeholderImage(item.id, item.title)}'">
            ${Store.isWatched(item.id) ? '<div class="card-watched">VISTO</div>' : ''}
            <div class="card-overlay">
                <h3 class="card-title">${escapeHtml(item.title || '')}</h3>
                <div class="card-meta">
                    ${item.year ? `<span>${escapeHtml(item.year)}</span>` : ''}
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
        el.heroImage.src = Store.getCover(item.id) || item.thumbUrl || placeholderImage(item.id, item.title);
        el.heroImage.onerror = () => { el.heroImage.src = placeholderImage(item.id, item.title); };
        el.heroTitle.innerText = item.title;
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
        el.modalTitle.innerText = item.title;
        el.modalYear.innerText = item.year || '';
        el.modalDuration.innerText = (eps.length > 1) ? `${eps.length} episodios`
            : (hasLinks ? `${item.links.length} ${item.links.length === 1 ? 'enlace' : 'enlaces'}`
            : (item.duration || (eps[0] && eps[0].duration) || item.size || ''));
        el.modalDescription.innerText = item.description || 'Sin descripción disponible.';
        if (el.modalRating) el.modalRating.innerText = (item.meta && item.meta.rating) ? ('★ ' + item.meta.rating) : '';
        if (el.detailGenres) {
            const gs = (item.meta && item.meta.genres) ? item.meta.genres.split(/[,/]/).map(g => g.trim()).filter(Boolean) : [];
            el.detailGenres.innerHTML = gs.map(g => `<span class="chip">${escapeHtml(g)}</span>`).join('');
        }
        const cover = Store.getCover(item.id);
        const backdrop = cover || item.backdropUrl || item.thumbUrl || (eps[0] && eps[0].thumbUrl) || placeholderImage(item.id, item.title);
        const poster = cover || item.thumbUrl || (eps[0] && eps[0].thumbUrl) || placeholderImage(item.id, item.title);
        el.detailBackdrop.src = backdrop;
        el.detailBackdrop.onerror = () => { el.detailBackdrop.src = placeholderImage(item.id, item.title); };
        if (el.detailPoster) { el.detailPoster.src = poster; el.detailPoster.onerror = () => { el.detailPoster.src = placeholderImage(item.id, item.title); }; }

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
        el.detailPlay.onclick = () => Player.play(Detail.primary, item);
        el.favBtn.onclick = () => { Store.toggleFav(item); this.updateFav(); CloudStore.saveFavs(); };
        if (el.watchedBtn) {
            this.updateWatched();
            el.watchedBtn.onclick = () => { Store.toggleWatched(item.id); this.updateWatched(); CloudStore.saveWatched && CloudStore.saveWatched(); Netflix.render(); };
        }
        if (el.coverBtn) {
            el.coverBtn.hidden = !state.isAdmin;
            el.coverBtn.onclick = async () => {
                const cur = Store.getCover(item.id) || '';
                const url = prompt('Pega la URL de la carátula (deja vacío para quitar):', cur);
                if (url === null) return;
                Store.setCover(item.id, url.trim());
                if (state.isAdmin) CloudStore.saveCovers();
                Detail.open(item);
                Netflix.render();   // refresca tarjetas
            };
        }
        if (opts.autoplay) Player.play(primary, item);
        TVNav.refresh();
        setTimeout(() => el.detailPlay.focus(), 50);
    },

    // Lista de enlaces (Enlace DAZN 1, 2, 3...) — cada uno abre directo de un toque
    renderSources(item) {
        el.sources.hidden = false;
        el.sourcesTrack.innerHTML = '';
        const playables = item.links.map((l, i) => this._linkToPlayable(item, l, i));
        playables.forEach((pl, i) => {
            const label = `<span class="source-ico">${pl.aceUrl ? '📡' : '▶'}</span> ${escapeHtml(item.links[i].label)}`;
            let node;
            if (pl.aceUrl) {
                // AceStream: abre la app directamente (un toque)
                node = document.createElement('a');
                node.href = pl.aceUrl; node.className = 'source-btn ace focusable'; node.tabIndex = 0; node.innerHTML = label;
                node.onclick = () => { Detail.primary = pl; };
            } else if (!pl.streamUrl && pl.externalUrl) {
                // Enlace externo (no reproducible dentro): abrir directo
                node = document.createElement('a');
                node.href = pl.externalUrl; node.target = '_blank'; node.rel = 'noopener';
                node.className = 'source-btn focusable'; node.tabIndex = 0; node.innerHTML = label;
                node.onclick = () => { Detail.primary = pl; };
            } else {
                // Vídeo reproducible dentro de la web (Telegram / mp4 directo)
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
        try { el.playerVideo.pause(); } catch {}
        el.playerVideo.removeAttribute('src'); el.playerVideo.load();
        el.playerIframe.hidden = true; el.playerIframe.src = '';
        el.detailBackdrop.hidden = false;
        el.detailHero.classList.remove('playing');
        el.playerStatus.hidden = true;
    },

    close() {
        Player.flushProgress();
        el.playerModal.hidden = true;
        el.body.style.overflow = '';
        this.resetVideo();
        // refrescar filas (continuar viendo / favoritos)
        if (state.currentView !== 'telegram') Netflix.render();
        TVNav.refresh();
    }
};

/* ===== Reproductores externos (VLC / AceStream / copiar) ===== */
const ExternalPlayers = {
    render(playable) {
        const box = el.playerOptions;
        box.innerHTML = '';
        if (!playable) { box.hidden = true; return; }
        const stream = playable.streamUrl ? absUrl(playable.streamUrl) : '';
        const items = [];

        if (playable.aceUrl) {
            items.push(`<a class="opt-btn ace focusable" tabindex="0" href="${escapeHtml(playable.aceUrl)}">▶ AceStream</a>`);
            const id = (playable.aceUrl.match(/[0-9a-fA-F]{40}/) || [''])[0];
            if (id) items.push(`<a class="opt-btn focusable" tabindex="0" href="intent:#Intent;scheme=acestream;package=org.acestream.media;S.content_id=${id};end">AceStream (Android)</a>`);
        }
        if (stream) {
            items.push(`<a class="opt-btn focusable" tabindex="0" href="vlc://${escapeHtml(stream)}">Abrir en VLC</a>`);
        } else if (playable.externalUrl) {
            items.push(`<a class="opt-btn focusable" tabindex="0" href="${escapeHtml(playable.externalUrl)}" target="_blank" rel="noopener">Abrir enlace</a>`);
        }

        const notBrowser = playable.streamUrl && playable.playableInBrowser === false;
        const label = playable.aceUrl
            ? 'Enlace AceStream: ábrelo con tu reproductor.'
            : (notBrowser ? `Formato ${(playable.ext || '').toUpperCase()} no compatible con el navegador. Ábrelo con un reproductor externo:` : 'Otros reproductores:');

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
            items.push(`<a class="opt-btn focusable" tabindex="0" href="vlc://${escapeHtml(url)}">▶ Abrir en VLC</a>`);
            items.push(`<a class="opt-btn focusable" tabindex="0" href="intent:${escapeHtml(url)}#Intent;type=video/*;action=android.intent.action.VIEW;end">Elegir reproductor (Android/TV)</a>`);
            items.push(`<a class="opt-btn focusable" tabindex="0" href="${escapeHtml(url)}" target="_blank" rel="noopener">Abrir en pestaña</a>`);
        }
        const label = isAce
            ? 'Si tu reproductor AceStream no se ha abierto solo, pulsa una opción:'
            : `Formato${info && info.ext ? ' ' + info.ext : ''} no compatible con el navegador. Abrir con tu reproductor:`;
        box.hidden = false;
        box.innerHTML = `<div class="opt-label">${escapeHtml(label)}</div><div class="opt-row">${items.join('')}</div>`;
    }
};

/* ===== Reproductor ===== */
const Player = {
    current: null,
    play(playable, parent) {
        if (!playable) return;
        this.flushProgress();
        this.current = { playable, parent };
        if (parent && parent.episodes && parent.episodes.length > 1) Store.setLastEp(parent.id, playable.id);

        // 1) AceStream: nunca dentro -> abrir reproductor externo (acestream://)
        if (playable.aceUrl) {
            this._openExternal(playable.aceUrl, playable);
            return;
        }
        // 2) Vídeo de Telegram (streamUrl) -> intentar dentro si es navegador-compatible
        if (playable.streamUrl && playable.playableInBrowser !== false) {
            this._playInside(playable, parent);
            return;
        }
        // 3) Vídeo de Telegram NO compatible (mkv/avi) -> reproductor externo con la URL del servidor
        if (playable.streamUrl) {
            this._openExternal(absUrl(playable.streamUrl), playable);
            return;
        }
        // 4) Enlace externo http(s): si parece vídeo directo, intentar dentro; si no, abrir externo
        if (playable.externalUrl) {
            if (/\.(mp4|m4v|webm|ogg|ogv|mov)(\?|#|$)/i.test(playable.externalUrl)) {
                el.detailHero.classList.add('playing'); el.detailBackdrop.hidden = true; el.playerStatus.hidden = true;
                el.playerIframe.hidden = true; el.playerIframe.src = '';
                el.playerVideo.hidden = false;
                el.playerVideo.src = playable.externalUrl;
                el.playerVideo.onerror = () => this._openExternal(playable.externalUrl, playable);
                el.playerVideo.play().catch(() => {});
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
        el.detailBackdrop.hidden = true;
        el.playerStatus.hidden = true;
        el.playerIframe.hidden = true; el.playerIframe.src = '';
        el.playerVideo.hidden = false;
        const v = el.playerVideo;
        v.src = playable.streamUrl;
        const resume = (Store.progress[playable.id] || {}).time || 0;
        try { v.volume = Store.volume; } catch {}
        v.onloadedmetadata = () => { if (resume > 8 && resume < v.duration - 5) v.currentTime = resume; };
        v.onerror = () => {
            // Si falla la reproducción interna, ofrecemos reproductor externo con la URL del servidor
            this._openExternal(absUrl(playable.streamUrl), playable);
        };
        v.ontimeupdate = () => this._tick();
        v.onvolumechange = () => { Store.volume = v.volume; };
        v.onended = () => { Store.clearProgress(playable.id); this.maybeNext(playable, parent); };
        v.play().catch(() => {});
    },

    // Abre el video con el reproductor externo del usuario (VLC/AceStream/etc.)
    _openExternal(url, playable) {
        el.detailHero.classList.remove('playing');
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
        const v = el.playerVideo, c = this.current;
        if (!c || !v.duration) return;
        const now = Date.now();
        if (now - this._lastSave > 5000) { this._lastSave = now; Store.saveProgress(c.playable, c.parent, v.currentTime, v.duration); CloudStore.saveProgress(); }
    },
    flushProgress() {
        const v = el.playerVideo, c = this.current;
        if (c && !v.hidden && v.currentTime > 8 && v.duration) Store.saveProgress(c.playable, c.parent, v.currentTime, v.duration);
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

/* ===== Cuenta / admin ===== */
const Admin = {
    async logout() {
        if (!confirm('¿Cerrar tu sesión de Telegram en esta web?')) return;
        try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {}
        try { localStorage.removeItem('tvp_token'); } catch {}
        location.reload();
    },
    async refresh() {
        try {
            await api('/api/admin/refresh', { method: 'POST', body: '{}' });
            const catalog = await api('/api/catalog?refresh=1');
            state.catalog = catalog; state.allItems = []; state.itemsById = {};
            catalog.categories.forEach(c => c.items.forEach(it => { it.category = c.name; state.allItems.push(it); state.itemsById[it.id] = it; }));
            App.populateFilters(); Netflix.render();
            alert('Catálogo actualizado.');
        } catch (e) { alert('Error al actualizar: ' + e.message); }
    },
    reflect() {
        const a = !!state.isAdmin;
        el.navTelegram.hidden = !a;
        if (el.viewSwitch) el.viewSwitch.hidden = !a;
        el.adminRefresh.hidden = !a;
        el.adminLock.hidden = false; // botón de cerrar sesión, visible al estar logado
    }
};

/* ===== VISTA CHAT (solo admin) ===== */
const Chat = {
    async load() {
        try { const r = await api('/api/topics'); state.topics = r.topics || []; }
        catch (e) { el.chatList.innerHTML = `<div class="chat-empty">${escapeHtml(e.message)}</div>`; return; }
        this.renderList();
    },
    renderList() {
        el.chatList.innerHTML = '';
        if (!state.topics.length) { el.chatList.innerHTML = '<div class="chat-empty" style="padding:2rem 1rem">No hay temas.</div>'; return; }
        state.topics.forEach(t => {
            const item = document.createElement('div');
            item.className = 'chat-item is-media focusable'; item.tabIndex = 0;
            item.innerHTML = `<div class="chat-avatar">${t.icon || '#'}</div>
                <div class="chat-item-body"><div class="chat-item-top"><span class="chat-item-name">${escapeHtml(t.title)}</span></div>
                <div class="chat-item-sub">Tema</div></div>`;
            item.onclick = () => this.open(t, item);
            el.chatList.appendChild(item);
        });
        TVNav.refresh();
    },
    async open(topic, node) {
        state.activeTopic = topic.id;
        $$('.chat-item', el.chatList).forEach(c => c.classList.remove('active'));
        if (node) node.classList.add('active');
        el.chatHeaderTitle.innerText = topic.title;
        el.chatHeaderMeta.innerText = 'cargando...';
        el.chatMessages.innerHTML = '<div class="chat-loading"><div class="loader small"></div></div>';
        let msgs;
        try { const r = await api('/api/chat/' + topic.id); msgs = r.messages || []; state.chatCache[topic.id] = msgs; }
        catch (e) { el.chatMessages.innerHTML = '<div class="chat-empty">Error: ' + escapeHtml(e.message) + '</div>'; return; }
        el.chatHeaderMeta.innerText = msgs.length + ' mensajes';
        this.renderMessages(msgs, topic);
    },
    renderMessages(msgs, topic) {
        el.chatMessages.innerHTML = '';
        const ordered = msgs.slice().reverse();
        if (!ordered.length) { el.chatMessages.innerHTML = '<div class="chat-empty">No hay mensajes.</div>'; return; }
        ordered.forEach(m => {
            const b = document.createElement('div');
            b.className = 'tg-message';
            const media = m.hasMedia ? `<div class="tg-media" ${m.thumbUrl ? `style="background-image:url(${m.thumbUrl})"` : ''}><span class="tg-media-icon">${m.isVideo ? '▶' : '🖼'}</span></div>` : '';
            b.innerHTML = `<div class="tg-bubble">
                ${media}
                ${m.text ? `<div class="tg-text">${this.linkify(escapeHtml(m.text))}</div>` : ''}
                <div class="tg-actions">
                    <button class="tg-edit focusable" tabindex="0">✎ Editar</button>
                    <button class="tg-del focusable" tabindex="0">🗑 Borrar</button>
                </div>
                <div class="tg-time">${fmtTime(m.date)}</div>
            </div>`;
            if (m.isVideo) {
                const bub = b.querySelector('.tg-bubble');
                bub.classList.add('playable');
            }
            $('.tg-edit', b).onclick = () => this.edit(topic, m);
            $('.tg-del', b).onclick = () => this.del(topic, m);
            el.chatMessages.appendChild(b);
        });
        el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
        TVNav.refresh();
    },
    async edit(topic, m) {
        const text = prompt('Editar mensaje:', m.text || '');
        if (text == null) return;
        try { await api('/api/admin/edit', { method: 'POST', body: JSON.stringify({ topicId: topic.id, msgId: m.id, text }) }); this.open(topic); }
        catch (e) { alert('Error al editar: ' + e.message); }
    },
    async del(topic, m) {
        if (!confirm('¿Borrar este mensaje del grupo? No se puede deshacer.')) return;
        try { await api('/api/admin/delete', { method: 'POST', body: JSON.stringify({ topicId: topic.id, msgId: m.id }) }); this.open(topic); }
        catch (e) { alert('Error al borrar: ' + e.message); }
    },
    linkify(t) { return t.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
};

/* ===== APP / VISTAS / BÚSQUEDA ===== */
const App = {
    switchView(view) {
        state.currentView = view;
        const isNet = view === 'netflix';
        el.netflixView.hidden = !isNet;
        el.telegramView.hidden = isNet;
        el.body.classList.toggle('telegram-mode', !isNet);
        el.navNetflix.classList.toggle('active', isNet);
        el.navTelegram.classList.toggle('active', !isNet);
        if (!isNet) {
            Chat.load().then(() => {
                if (!state.activeTopic && state.topics.length) {
                    const node = $$('.chat-item', el.chatList)[0];
                    Chat.open(state.topics[0], node);
                }
            });
        }
        TVNav.refresh();
    },
    search() {
        const q = (el.searchInput.value || '').trim().toLowerCase();
        const genre = (el.filterGenre.value || '').toLowerCase();
        const year = el.filterYear.value || '';
        if (!q && !genre && !year) { el.searchResults.innerHTML = ''; return; }
        const res = state.allItems.filter(it => {
            const okText = !q || (it.title || '').toLowerCase().includes(q) ||
                (it.description || '').toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q);
            const okGenre = !genre || ((it.meta && it.meta.genres) || '').toLowerCase().includes(genre);
            const okYear = !year || String(it.year) === year;
            return okText && okGenre && okYear;
        });
        if (!res.length) { el.searchResults.innerHTML = '<div class="search-empty">Sin resultados.</div>'; return; }
        el.searchResults.innerHTML = '';
        res.forEach(it => {
            const c = document.createElement('div');
            c.className = 'search-card focusable'; c.tabIndex = 0;
            c.innerHTML = `<img class="search-image" src="${it.thumbUrl || placeholderImage(it.id, it.title)}" alt=""
                onerror="this.src='${placeholderImage(it.id, it.title)}'">
                <div class="search-meta"><h3>${escapeHtml(it.title)}</h3>
                <p>${escapeHtml((it.description || '').slice(0, 140))}</p>
                <span class="search-cat">${escapeHtml(it.category || '')}</span></div>`;
            c.onclick = () => { this.closeSearch(); Detail.open(it); };
            el.searchResults.appendChild(c);
        });
        TVNav.refresh();
    },
    populateFilters() {
        const genres = new Set(), years = new Set();
        state.allItems.forEach(it => {
            if (it.meta && it.meta.genres) it.meta.genres.split(/[,/]/).forEach(g => { const t = g.trim(); if (t) genres.add(t); });
            if (it.year) years.add(String(it.year));
        });
        el.filterGenre.innerHTML = '<option value="">Todos los géneros</option>' +
            [...genres].sort().map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
        el.filterYear.innerHTML = '<option value="">Todos los años</option>' +
            [...years].sort((a, b) => b - a).map(y => `<option value="${y}">${y}</option>`).join('');
    },
    openSearch() { el.searchOverlay.hidden = false; el.searchInput.focus(); el.body.style.overflow = 'hidden'; },
    closeSearch() { el.searchOverlay.hidden = true; el.searchInput.value = ''; el.filterGenre.value = ''; el.filterYear.value = ''; el.searchResults.innerHTML = ''; el.body.style.overflow = ''; }
};

/* ===== Navegación con mando de TV Box (flechas + OK + atrás) ===== */
const TVNav = {
    SEL: '.card, .card-remove, .btn, .episode, .chat-item, .opt-btn, .source-btn, .filter-select, .nav-links a, .view-btn, .icon-btn, .search-btn, .slider-arrow, .search-card, #search-input, .tg-edit, .tg-del, .modal-close',
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
    init() {
        document.addEventListener('keydown', (e) => {
            const k = e.key;
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
                if (k === 'ArrowLeft' || k === 'ArrowRight') {
                    if (document.activeElement === el.searchInput) return; // dejar mover el cursor en el buscador
                }
                e.preventDefault();
                this.move(k.replace('Arrow', '').toLowerCase());
            } else if (k === 'Enter') {
                const a = document.activeElement;
                if (a && a !== el.searchInput && a.click) { e.preventDefault(); a.click(); }
            } else if (k === 'Backspace' || k === 'GoBack' || k === 'BrowserBack') {
                if (document.activeElement === el.searchInput) return;
                if (!el.playerModal.hidden) { e.preventDefault(); Detail.close(); }
                else if (!el.searchOverlay.hidden) { e.preventDefault(); App.closeSearch(); }
            }
        });
    }
};

/* ===== ARRANQUE ===== */
async function boot() {
    try {
        const info = await api('/api/app').catch(() => null);
        if (info && info.appName) { el.brand.innerText = info.appName.toUpperCase(); document.title = info.appName; }

        const me = await api('/api/me').catch(() => ({ loggedIn: false }));
        if (!me.loggedIn) { el.loadingScreen.classList.add('hidden'); Login.open(); return; }
        if (me.inGroup === false) {
            el.loadingScreen.classList.add('hidden');
            el.rowsContainer.innerHTML = `<div class="empty-state">🔒 Tu cuenta <b>${escapeHtml(me.name || '')}</b> no es miembro del grupo.<br><br>
                Pide al administrador que te añada al grupo de Telegram para poder ver el contenido.<br><br>
                <button class="btn btn-play" onclick="location.reload()" style="display:inline-flex">Reintentar</button></div>`;
            return;
        }

        state.isAdmin = !!me.isAdmin;
        state.userName = me.name || '';
        Admin.reflect();

        // Firebase: sincronizar favoritos y progreso del usuario
        CloudStore.init(me.name || 'user');
        await CloudStore.syncFavs();
        await CloudStore.syncProgress();
        await CloudStore.syncWatched();
        await CloudStore.syncCovers();

        el.loadingText.innerText = 'Cargando catálogo...';
        // 1) Mostrar caché del navegador inmediatamente (si existe y es de hoy)
        let usedCache = false;
        try {
            const cached = JSON.parse(sessionStorage.getItem('tvp_catalog') || 'null');
            if (cached && cached.ts && (Date.now() - cached.ts) < 30 * 60 * 1000) {
                state.catalog = cached.data;
                state.allItems = []; state.itemsById = {};
                state.catalog.categories.forEach(c => c.items.forEach(it => { it.category = c.name; state.allItems.push(it); state.itemsById[it.id] = it; }));
                App.populateFilters(); Netflix.render(); App.switchView('netflix');
                usedCache = true;
            }
        } catch {}
        // 2) Si había caché, refrescar en segundo plano; si no, cargar ahora
        if (usedCache) {
            (async () => {
                try {
                    const fresh = await api('/api/catalog');
                    state.catalog = fresh; state.allItems = []; state.itemsById = {};
                    fresh.categories.forEach(c => c.items.forEach(it => { it.category = c.name; state.allItems.push(it); state.itemsById[it.id] = it; }));
                    try { sessionStorage.setItem('tvp_catalog', JSON.stringify({ ts: Date.now(), data: fresh })); } catch {}
                    App.populateFilters(); Netflix.render();
                } catch {}
            })();
            return; // ya cargado desde caché
        }
        const catalog = await api('/api/catalog');
        state.catalog = catalog;
        catalog.categories.forEach(c => c.items.forEach(it => {
            it.category = c.name; state.allItems.push(it); state.itemsById[it.id] = it;
        }));
        try { sessionStorage.setItem('tvp_catalog', JSON.stringify({ ts: Date.now(), data: catalog })); } catch {}
        App.populateFilters();
        Netflix.render();
        App.switchView('netflix');
        setTimeout(() => { const f = $('.card'); if (f) f.focus(); }, 200);
    } catch (e) {
        console.error(e);
        el.rowsContainer.innerHTML = `<div class="empty-state">No se pudo cargar el contenido.<br>${escapeHtml(e.message)}</div>`;
    } finally {
        el.loadingScreen.classList.add('hidden');
    }
}

function wireUi() {
    el.navNetflix.onclick = (e) => { e.preventDefault(); App.switchView('netflix'); };
    el.navTelegram.onclick = (e) => { e.preventDefault(); App.switchView('telegram'); };
    el.adminLock.onclick = () => Admin.logout();
    $('#btn-send-code').onclick = () => Login.sendCode();
    $('#btn-verify-code').onclick = () => Login.verifyCode();
    $('#btn-verify-password').onclick = () => Login.verifyPassword();
    $('#btn-back-phone').onclick = () => Login.step('phone');
    $('#login-phone').addEventListener('keydown', e => { if (e.key === 'Enter') Login.sendCode(); });
    $('#login-code').addEventListener('keydown', e => { if (e.key === 'Enter') Login.verifyCode(); });
    $('#login-password').addEventListener('keydown', e => { if (e.key === 'Enter') Login.verifyPassword(); });
    $('.modal-close', el.playerModal).onclick = () => Detail.close();
    $('.modal-overlay', el.playerModal).onclick = () => Detail.close();
    el.searchBtn.onclick = () => App.openSearch();
    $('.search-close', el.searchOverlay).onclick = () => App.closeSearch();
    el.searchInput.addEventListener('input', () => App.search());
    el.filterGenre.addEventListener('change', () => App.search());
    el.filterYear.addEventListener('change', () => App.search());
    el.adminRefresh.onclick = () => Admin.refresh();
    el.navLinks.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-cat]'); if (!a) return;
        e.preventDefault();
        $$('#nav-links a').forEach(x => x.classList.remove('active'));
        a.classList.add('active');
        if (!a.dataset.cat) { Netflix.render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
        Netflix.renderCategory(a.dataset.cat);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!el.searchOverlay.hidden) App.closeSearch();
        else if (!el.playerModal.hidden) Detail.close();
    });
    window.addEventListener('scroll', () => { el.navbar.classList.toggle('scrolled', window.scrollY > 50); });
    // ocultar Chat hasta que haya admin
    el.navTelegram.hidden = true;
    TVNav.init();
}

document.addEventListener('DOMContentLoaded', () => { wireUi(); boot(); });
