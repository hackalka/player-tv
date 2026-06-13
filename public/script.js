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
    if (Store.adminKey) headers['x-admin-key'] = Store.adminKey;
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const r = await fetch(path, Object.assign({}, opts, { headers }));
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
    detailPlay: $('#detail-play'),
    favBtn: $('#fav-btn'),
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
    loadingText: $('#loading-text')
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
        items.forEach(it => track.appendChild(this.card(it, kind)));
        $('.prev', row).onclick = () => track.scrollBy({ left: -800, behavior: 'smooth' });
        $('.next', row).onclick = () => track.scrollBy({ left: 800, behavior: 'smooth' });
        return row;
    },

    card(item, kind) {
        const card = document.createElement('div');
        card.className = 'card focusable';
        card.tabIndex = 0;
        const img = item.thumbUrl || placeholderImage(item.id, item.title || item.epTitle);
        const pct = (kind === 'continue' && item.duration) ? Math.min(100, Math.round(item.time / item.duration * 100)) : 0;
        card.innerHTML = `
            <img class="card-image" src="${img}" alt="${escapeHtml(item.title || '')}" loading="lazy"
                 onerror="this.src='${placeholderImage(item.id, item.title)}'">
            <div class="card-overlay">
                <h3 class="card-title">${escapeHtml(item.title || '')}</h3>
                <div class="card-meta">
                    ${item.year ? `<span>${escapeHtml(item.year)}</span>` : ''}
                    ${item.isSeries ? `<span class="badge-series">${item.episodeCount} CAP</span>` : (item.links && item.links.length > 1 ? `<span class="badge-series">${item.links.length} ENLACES</span>` : (item.duration && kind !== 'continue' ? `<span>${escapeHtml(item.duration)}</span>` : ''))}
                    <span class="badge-hd">HD</span>
                </div>
            </div>
            ${pct ? `<div class="card-progress"><span style="width:${pct}%"></span></div>` : ''}
            <div class="card-actions">
                <button class="card-action-btn primary play-btn" title="Reproducir"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></button>
            </div>`;
        const onActivate = () => {
            if (kind === 'continue') Detail.resume(item);
            else Detail.open(item);
        };
        $('.play-btn', card).onclick = (e) => { e.stopPropagation(); kind === 'continue' ? Detail.resume(item) : Detail.open(item, { autoplay: true }); };
        card.onclick = onActivate;
        return card;
    },

    updateHero(item) {
        if (!item) return;
        el.heroImage.src = item.thumbUrl || placeholderImage(item.id, item.title);
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
        el.modalDescription.innerText = this._descWithMeta(item);
        const poster = item.thumbUrl || (eps[0] && eps[0].thumbUrl) || placeholderImage(item.id, item.title);
        el.detailBackdrop.src = poster;
        el.detailBackdrop.onerror = () => { el.detailBackdrop.src = placeholderImage(item.id, item.title); };

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
        el.favBtn.onclick = () => { Store.toggleFav(item); this.updateFav(); };
        if (opts.autoplay) Player.play(primary, item);
        TVNav.refresh();
        setTimeout(() => el.detailPlay.focus(), 50);
    },

    // Lista de enlaces (Enlace DAZN 1, 2, 3...) dentro de una misma portada
    renderSources(item) {
        el.sources.hidden = false;
        el.sourcesTrack.innerHTML = '';
        const playables = item.links.map((l, i) => this._linkToPlayable(item, l, i));
        playables.forEach((pl, i) => {
            const btn = document.createElement('button');
            btn.className = 'source-btn focusable' + (pl.aceUrl ? ' ace' : '');
            btn.tabIndex = 0;
            btn.innerHTML = `<span class="source-ico">${pl.aceUrl ? '📡' : '▶'}</span> ${escapeHtml(item.links[i].label)}`;
            btn.onclick = () => {
                $$('.source-btn', el.sourcesTrack).forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                Detail.primary = pl;
                ExternalPlayers.render(pl);
                Player.play(pl, item);
            };
            el.sourcesTrack.appendChild(btn);
        });
        const first = playables[0];
        if (first) $$('.source-btn', el.sourcesTrack)[0].classList.add('active');
        return first;
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

    renderEpisodes(eps, parent) {
        el.episodesTrack.innerHTML = '';
        eps.forEach((ep, i) => {
            const row = document.createElement('div');
            row.className = 'episode focusable'; row.tabIndex = 0;
            const thumb = ep.thumbUrl || placeholderImage(ep.id, ep.title);
            const prog = Store.progress[ep.id];
            const pct = prog && prog.duration ? Math.min(100, Math.round(prog.time / prog.duration * 100)) : 0;
            row.innerHTML = `
                <div class="episode-index">${i + 1}</div>
                <img class="episode-thumb" src="${thumb}" alt="" onerror="this.src='${placeholderImage(ep.id, ep.title)}'">
                <div class="episode-info">
                    <div class="episode-name">${escapeHtml(ep.title)}</div>
                    <div class="episode-sub">${escapeHtml(ep.duration || ep.size || '')}${pct ? ` · ${pct}% visto` : ''}</div>
                </div>
                <span class="episode-play"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span>`;
            row.onclick = () => { ExternalPlayers.render(ep); Player.play(ep, parent); };
            el.episodesTrack.appendChild(row);
        });
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
            items.push(`<button class="opt-btn focusable" tabindex="0" data-copy="${escapeHtml(stream)}">Copiar enlace</button>`);
        } else if (playable.externalUrl) {
            items.push(`<a class="opt-btn focusable" tabindex="0" href="${escapeHtml(playable.externalUrl)}" target="_blank" rel="noopener">Abrir enlace</a>`);
            items.push(`<button class="opt-btn focusable" tabindex="0" data-copy="${escapeHtml(playable.externalUrl)}">Copiar enlace</button>`);
        }

        const notBrowser = playable.streamUrl && playable.playableInBrowser === false;
        const label = playable.aceUrl
            ? 'Enlace AceStream: ábrelo con tu reproductor.'
            : (notBrowser ? `Formato ${(playable.ext || '').toUpperCase()} no compatible con el navegador. Ábrelo con un reproductor externo:` : 'Otros reproductores:');

        if (!items.length) { box.hidden = true; return; }
        box.hidden = false;
        box.innerHTML = `<div class="opt-label">${escapeHtml(label)}</div><div class="opt-row">${items.join('')}</div>`;
        $$('button[data-copy]', box).forEach(b => b.onclick = () => {
            navigator.clipboard.writeText(b.dataset.copy).then(() => { b.innerText = '¡Copiado!'; setTimeout(() => b.innerText = 'Copiar enlace', 1500); }).catch(() => {});
        });
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

        // AceStream: no se reproduce dentro; mostrar opciones
        if (playable.aceUrl && !playable.streamUrl) {
            ExternalPlayers.render(playable);
            el.playerStatus.hidden = false;
            el.playerStatus.innerText = 'Este contenido es AceStream. Usa el botón "AceStream" para abrirlo.';
            return;
        }
        el.detailHero.classList.add('playing');
        el.detailBackdrop.hidden = true;
        el.playerStatus.hidden = true;

        if (playable.streamUrl) {
            el.playerIframe.hidden = true; el.playerIframe.src = '';
            el.playerVideo.hidden = false;
            el.playerVideo.src = playable.streamUrl;
            const resume = (Store.progress[playable.id] || {}).time || 0;
            el.playerVideo.onloadedmetadata = () => { if (resume > 8 && resume < el.playerVideo.duration - 5) el.playerVideo.currentTime = resume; };
            el.playerVideo.onerror = () => this.onPlayError(playable);
            el.playerVideo.ontimeupdate = () => this._tick();
            el.playerVideo.onended = () => Store.clearProgress(playable.id);
            el.playerVideo.play().catch(() => {});
            return;
        }
        if (playable.externalUrl) {
            el.playerVideo.hidden = true;
            el.playerIframe.hidden = false; el.playerIframe.src = this.embed(playable.externalUrl);
            return;
        }
        this.onPlayError(playable);
    },

    onPlayError(playable) {
        el.detailHero.classList.remove('playing');
        el.detailBackdrop.hidden = false;
        el.playerStatus.hidden = false;
        el.playerStatus.innerText = playable.playableInBrowser === false
            ? `Este formato (${(playable.ext || '').toUpperCase()}) no se puede reproducir aquí. Ábrelo con un reproductor externo (abajo).`
            : 'No se pudo reproducir. Prueba con un reproductor externo (abajo).';
        ExternalPlayers.render(playable);
    },

    _lastSave: 0,
    _tick() {
        const v = el.playerVideo, c = this.current;
        if (!c || !v.duration) return;
        const now = Date.now();
        if (now - this._lastSave > 5000) { this._lastSave = now; Store.saveProgress(c.playable, c.parent, v.currentTime, v.duration); }
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

/* ===== ADMIN ===== */
const Admin = {
    async login() {
        const pwd = prompt('Contraseña de administrador:');
        if (pwd == null) return;
        try {
            await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: pwd }) });
            Store.adminKey = pwd;
            state.isAdmin = true;
            this.reflect();
            alert('Acceso de administrador activado. Ya puedes ver y editar el chat.');
        } catch (e) { alert('No autorizado: ' + e.message); }
    },
    logout() { Store.adminKey = ''; state.isAdmin = false; this.reflect(); App.switchView('netflix'); },
    reflect() {
        const show = !!(state.adminEnabled && state.isAdmin);
        el.navTelegram.hidden = !show;
        if (el.viewSwitch) el.viewSwitch.hidden = !show;
        el.adminLock.classList.toggle('active', state.isAdmin);
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
    search(q) {
        q = q.trim().toLowerCase();
        if (!q) { el.searchResults.innerHTML = ''; return; }
        const res = state.allItems.filter(it =>
            (it.title || '').toLowerCase().includes(q) ||
            (it.description || '').toLowerCase().includes(q) ||
            (it.category || '').toLowerCase().includes(q));
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
    openSearch() { el.searchOverlay.hidden = false; el.searchInput.focus(); el.body.style.overflow = 'hidden'; },
    closeSearch() { el.searchOverlay.hidden = true; el.searchInput.value = ''; el.searchResults.innerHTML = ''; el.body.style.overflow = ''; }
};

/* ===== Navegación con mando de TV Box (flechas + OK + atrás) ===== */
const TVNav = {
    SEL: '.card, .btn, .episode, .chat-item, .opt-btn, .source-btn, .nav-links a, .view-btn, .icon-btn, .search-btn, .slider-arrow, .search-card, #search-input, .tg-edit, .tg-del, .modal-close',
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
        if (info) {
            if (info.appName) { el.brand.innerText = info.appName.toUpperCase(); document.title = info.appName; }
            state.adminEnabled = !!info.adminEnabled;
        }
        // estado admin
        state.isAdmin = !!(state.adminEnabled && Store.adminKey);
        if (state.isAdmin) { try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: Store.adminKey }) }); } catch { Store.adminKey = ''; state.isAdmin = false; } }
        Admin.reflect();
        el.adminLock.hidden = !state.adminEnabled;

        el.loadingText.innerText = 'Cargando catálogo...';
        const catalog = await api('/api/catalog');
        state.catalog = catalog;
        catalog.categories.forEach(c => c.items.forEach(it => {
            it.category = c.name; state.allItems.push(it); state.itemsById[it.id] = it;
        }));
        Netflix.render();
        App.switchView('netflix');
        setTimeout(() => { const f = $('.card'); if (f) f.focus(); }, 200);
    } catch (e) {
        console.error(e);
        el.rowsContainer.innerHTML = `<div class="empty-state">No se pudo cargar el contenido.<br>${escapeHtml(e.message)}<br><br>
            Revisa que el servidor tenga una sesión válida (variable <b>TG_SESSION</b>).</div>`;
    } finally {
        el.loadingScreen.classList.add('hidden');
    }
}

function wireUi() {
    el.navNetflix.onclick = (e) => { e.preventDefault(); App.switchView('netflix'); };
    el.navTelegram.onclick = (e) => { e.preventDefault(); App.switchView('telegram'); };
    el.adminLock.onclick = () => { state.isAdmin ? (confirm('¿Cerrar sesión de administrador?') && Admin.logout()) : Admin.login(); };
    $('.modal-close', el.playerModal).onclick = () => Detail.close();
    $('.modal-overlay', el.playerModal).onclick = () => Detail.close();
    el.searchBtn.onclick = () => App.openSearch();
    $('.search-close', el.searchOverlay).onclick = () => App.closeSearch();
    el.searchInput.addEventListener('input', e => App.search(e.target.value));
    el.navLinks.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-cat]'); if (!a) return;
        e.preventDefault();
        $$('#nav-links a').forEach(x => x.classList.remove('active'));
        a.classList.add('active');
        if (!a.dataset.cat) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
        const row = $$('.row-title').find(t => t.innerText.includes(a.dataset.cat));
        if (row) row.closest('.content-row').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
