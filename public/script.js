/* =====================================================================
 * Tv Player — UI (modelo 100% cliente; usa window.Engine)
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

// Carga perezosa de miniatura en un <img>
async function loadThumb(imgEl, ref, seed, label) {
    if (!ref) return;
    try { const url = await Engine.getThumb(ref); if (url && imgEl) imgEl.src = url; }
    catch {}
}

/* ===== Almacenamiento local ===== */
const Store = {
    _get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } },
    _set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    get progress() { return this._get('tvp_progress', {}); }, set progress(v) { this._set('tvp_progress', v); },
    get favs() { return this._get('tvp_favs', {}); }, set favs(v) { this._set('tvp_favs', v); },
    get lastEp() { return this._get('tvp_lastep', {}); }, set lastEp(v) { this._set('tvp_lastep', v); },
    saveProgress(playable, parent, time, duration) {
        if (!playable || !playable.id || !time || time < 8) return;
        const p = this.progress;
        p[playable.id] = { id: playable.id, title: (parent && parent.title) || playable.title || 'Video', thumb: playable.thumb || (parent && parent.thumb) || null, src: playable.src, aceUrl: playable.aceUrl, externalUrl: playable.externalUrl, playableInBrowser: playable.playableInBrowser !== false, parentId: (parent && parent.id) || playable.id, time, duration: duration || 0, updated: Date.now() };
        this.progress = p;
    },
    clearProgress(id) { const p = this.progress; delete p[id]; this.progress = p; },
    continueList() { return Object.values(this.progress).filter(r => r.time > 8 && (!r.duration || r.time < r.duration * 0.95)).sort((a, b) => b.updated - a.updated).slice(0, 20); },
    isFav(id) { return !!this.favs[id]; },
    toggleFav(item) { const f = this.favs; if (f[item.id]) delete f[item.id]; else f[item.id] = item; this.favs = f; return !!f[item.id]; },
    favList() { return Object.values(this.favs).reverse(); },
    setLastEp(seriesId, epId) { const l = this.lastEp; l[seriesId] = epId; this.lastEp = l; }
};

const state = { catalog: { categories: [] }, allItems: [], itemsById: {}, topics: [], activeTopic: null, isAdmin: false, currentView: 'netflix' };

const el = {
    body: document.body, brand: $('#brand-name'),
    netflixView: $('#netflix-view'), telegramView: $('#telegram-view'),
    navbar: $('.navbar'), navNetflix: $('#nav-netflix'), navTelegram: $('#nav-telegram'), viewSwitch: $('.view-switch'),
    navLinks: $('#nav-links'), adminLock: $('#admin-lock'), adminRefresh: $('#admin-refresh'),
    filterGenre: $('#filter-genre'), filterYear: $('#filter-year'),
    heroImage: $('#hero-image'), heroTitle: $('#hero-title'), heroDescription: $('#hero-description'), heroBadge: $('#hero-badge'), heroPlay: $('#hero-play'), heroInfo: $('#hero-info'),
    rowsContainer: $('#rows-container'),
    playerModal: $('#player-modal'), playerIframe: $('#player-iframe'), playerVideo: $('#player-video'), playerStatus: $('#player-status'),
    detailHero: $('#detail-hero'), detailBackdrop: $('#detail-backdrop'), detailPlay: $('#detail-play'), favBtn: $('#fav-btn'),
    playerOptions: $('#player-options'), episodeList: $('#episode-list'), episodesTrack: $('#episodes-track'),
    sources: $('#sources'), sourcesTrack: $('#sources-track'),
    modalTitle: $('#modal-title'), modalDescription: $('#modal-description'), modalYear: $('#modal-year'), modalDuration: $('#modal-duration'),
    searchBtn: $('.search-btn'), searchOverlay: $('#search-overlay'), searchInput: $('#search-input'), searchResults: $('#search-results'),
    chatList: $('#chat-list'), chatMessages: $('#chat-messages'), chatHeaderTitle: $('#chat-header-title'), chatHeaderMeta: $('#chat-header-meta'),
    loadingScreen: $('#loading-screen'), loadingText: $('#loading-text'), loginModal: $('#login-modal')
};

/* ===== NETFLIX ===== */
const Netflix = {
    render() {
        el.rowsContainer.innerHTML = '';
        const cats = state.catalog.categories.filter(c => c.items && c.items.length);
        el.navLinks.innerHTML = '<li><a href="#" class="active" data-cat="">Inicio</a></li>' + cats.map(c => `<li><a href="#" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)}</a></li>`).join('');
        const cont = Store.continueList();
        if (cont.length) el.rowsContainer.appendChild(this.row('▶ Continuar viendo', cont, 'continue'));
        const favs = Store.favList();
        if (favs.length) el.rowsContainer.appendChild(this.row('❤ Mi lista', favs));
        const nov = state.allItems.filter(it => it.date).sort((a, b) => b.date - a.date).slice(0, 18);
        if (nov.length) el.rowsContainer.appendChild(this.row('🆕 Novedades', nov));
        if (!cats.length && !cont.length && !favs.length) { el.rowsContainer.innerHTML = '<div class="empty-state">No se encontró contenido en los temas con la etiqueta configurada.</div>'; return; }
        let heroPool = [];
        cats.forEach(c => { heroPool = heroPool.concat(c.items.slice(0, 5)); el.rowsContainer.appendChild(this.row((c.icon || '') + ' ' + c.name, c.items)); });
        if (heroPool.length) { this.updateHero(heroPool[0]); if (heroPool.length > 1) { let i = 0; clearInterval(this._t); this._t = setInterval(() => { i = (i + 1) % heroPool.length; this.updateHero(heroPool[i]); }, 10000); } }
        TVNav.refresh();
    },
    row(title, items, kind) {
        const row = document.createElement('section'); row.className = 'content-row';
        row.innerHTML = `<div class="row-header"><h2 class="row-title">${escapeHtml(title)}</h2></div>
            <div class="row-slider">
                <button class="slider-arrow prev"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg></button>
                <div class="slider-track"></div>
                <button class="slider-arrow next"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg></button>
            </div>`;
        const track = $('.slider-track', row);
        items.forEach(it => track.appendChild(this.card(it, kind)));
        $('.prev', row).onclick = () => track.scrollBy({ left: -800, behavior: 'smooth' });
        $('.next', row).onclick = () => track.scrollBy({ left: 800, behavior: 'smooth' });
        return row;
    },
    card(item, kind) {
        const card = document.createElement('div'); card.className = 'card focusable'; card.tabIndex = 0;
        const pct = (kind === 'continue' && item.duration) ? Math.min(100, Math.round(item.time / item.duration * 100)) : 0;
        card.innerHTML = `
            <img class="card-image" src="${placeholderImage(item.id, item.title)}" alt="${escapeHtml(item.title || '')}">
            <div class="card-overlay"><h3 class="card-title">${escapeHtml(item.title || '')}</h3>
            <div class="card-meta">${item.year ? `<span>${escapeHtml(item.year)}</span>` : ''}
            ${item.isSeries ? `<span class="badge-series">${item.episodeCount} CAP</span>` : (item.links && item.links.length > 1 ? `<span class="badge-series">${item.links.length} ENLACES</span>` : (item.duration && kind !== 'continue' ? `<span>${escapeHtml(item.duration)}</span>` : ''))}
            <span class="badge-hd">HD</span></div></div>
            ${pct ? `<div class="card-progress"><span style="width:${pct}%"></span></div>` : ''}
            ${kind === 'continue' ? '<button class="card-remove" title="Quitar">✕</button>' : ''}
            <div class="card-actions"><button class="card-action-btn primary play-btn"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></button></div>`;
        loadThumb($('.card-image', card), item.thumb, item.id, item.title);
        $('.play-btn', card).onclick = (e) => { e.stopPropagation(); kind === 'continue' ? Detail.resume(item) : Detail.open(item, { autoplay: true }); };
        const rm = $('.card-remove', card); if (rm) rm.onclick = (e) => { e.stopPropagation(); Store.clearProgress(item.id); Netflix.render(); };
        card.onclick = () => kind === 'continue' ? Detail.resume(item) : Detail.open(item);
        return card;
    },
    updateHero(item) {
        if (!item) return;
        el.heroImage.src = placeholderImage(item.id, item.title);
        loadThumb(el.heroImage, item.thumb, item.id, item.title);
        el.heroTitle.innerText = item.title; el.heroDescription.innerText = item.description || ''; el.heroBadge.innerText = item.category || '';
        el.heroPlay.onclick = () => Detail.open(item, { autoplay: true });
        el.heroInfo.onclick = () => Detail.open(item);
    }
};

/* ===== DETALLE ===== */
const Detail = {
    current: null, primary: null,
    open(item, opts = {}) {
        this.current = item;
        const eps = item.episodes || [];
        const hasLinks = !!(item.links && item.links.length);
        el.modalTitle.innerText = item.title;
        el.modalYear.innerText = item.year || '';
        el.modalDuration.innerText = (eps.length > 1) ? `${eps.length} episodios` : (hasLinks ? `${item.links.length} ${item.links.length === 1 ? 'enlace' : 'enlaces'}` : (item.duration || item.size || ''));
        el.modalDescription.innerText = this._descMeta(item);
        el.detailBackdrop.src = placeholderImage(item.id, item.title);
        loadThumb(el.detailBackdrop, item.thumb, item.id, item.title);
        this.resetVideo(); this.resetSources(); this.updateFav();
        el.playerModal.hidden = false; el.body.style.overflow = 'hidden';
        let primary;
        if (eps.length > 1) { el.episodeList.hidden = false; this.renderEpisodes(eps, item); const last = Store.lastEp[item.id]; primary = eps.find(e => String(e.id) === String(last)) || eps[0]; }
        else if (hasLinks) { el.episodeList.hidden = true; primary = this.renderSources(item); }
        else { el.episodeList.hidden = true; primary = eps[0] || item; }
        this.primary = primary;
        ExternalPlayers.render(primary);
        el.detailPlay.onclick = () => Player.play(Detail.primary, item);
        el.favBtn.onclick = () => { Store.toggleFav(item); this.updateFav(); };
        if (opts.autoplay) Player.play(primary, item);
        TVNav.refresh(); setTimeout(() => el.detailPlay.focus(), 50);
    },
    _descMeta(item) {
        let d = item.description || 'Sin descripción disponible.';
        const m = item.meta || {}; const bits = [];
        if (m.genres) bits.push(m.genres); if (m.rating) bits.push('★ ' + m.rating);
        if (m.seasons) bits.push(m.seasons + (m.seasons === '1' ? ' temporada' : ' temporadas')); if (m.status) bits.push(m.status);
        return bits.length ? bits.join('  ·  ') + '\n\n' + d : d;
    },
    renderSources(item) {
        el.sources.hidden = false; el.sourcesTrack.innerHTML = '';
        const playables = item.links.map((l, i) => ({ id: item.id + '-l' + i, title: l.label, src: l.src, aceUrl: l.aceUrl, externalUrl: l.externalUrl, playableInBrowser: l.playableInBrowser, thumb: item.thumb }));
        playables.forEach((pl, i) => {
            const btn = document.createElement('button'); btn.className = 'source-btn focusable' + (pl.aceUrl ? ' ace' : ''); btn.tabIndex = 0;
            btn.innerHTML = `<span class="source-ico">${pl.aceUrl ? '📡' : '▶'}</span> ${escapeHtml(item.links[i].label)}`;
            btn.onclick = () => { $$('.source-btn', el.sourcesTrack).forEach(b => b.classList.remove('active')); btn.classList.add('active'); Detail.primary = pl; ExternalPlayers.render(pl); Player.play(pl, item); };
            el.sourcesTrack.appendChild(btn);
        });
        if (playables[0]) $$('.source-btn', el.sourcesTrack)[0].classList.add('active');
        return playables[0];
    },
    resetSources() { el.sources.hidden = true; el.sourcesTrack.innerHTML = ''; },
    resume(record) {
        const parent = state.itemsById[record.parentId];
        if (parent) { this.open(parent, { autoplay: true }); return; }
        this.current = record; this.primary = record;
        el.modalTitle.innerText = record.title; el.modalDescription.innerText = ''; el.modalYear.innerText = ''; el.modalDuration.innerText = '';
        el.detailBackdrop.src = placeholderImage(record.id, record.title); loadThumb(el.detailBackdrop, record.thumb, record.id, record.title);
        el.episodeList.hidden = true; this.resetVideo(); this.resetSources(); this.updateFav();
        el.playerModal.hidden = false; el.body.style.overflow = 'hidden';
        ExternalPlayers.render(record); el.detailPlay.onclick = () => Player.play(record, record);
        Player.play(record, record); TVNav.refresh();
    },
    updateFav() { const it = this.current; el.favBtn.querySelector('.fav-ico').innerText = (it && Store.isFav(it.id)) ? '✓' : '＋'; },
    renderEpisodes(eps, parent) {
        el.episodesTrack.innerHTML = '';
        eps.forEach((ep, i) => {
            const row = document.createElement('div'); row.className = 'episode focusable'; row.tabIndex = 0;
            const prog = Store.progress[ep.id]; const pct = prog && prog.duration ? Math.min(100, Math.round(prog.time / prog.duration * 100)) : 0;
            row.innerHTML = `<div class="episode-index">${i + 1}</div>
                <img class="episode-thumb" src="${placeholderImage(ep.id, ep.title)}" alt="">
                <div class="episode-info"><div class="episode-name">${escapeHtml(ep.title)}</div>
                <div class="episode-sub">${escapeHtml(ep.duration || ep.size || '')}${pct ? ` · ${pct}% visto` : ''}</div></div>
                <span class="episode-play"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span>`;
            loadThumb($('.episode-thumb', row), ep.thumb, ep.id, ep.title);
            row.onclick = () => { Detail.primary = ep; ExternalPlayers.render(ep); Player.play(ep, parent); };
            el.episodesTrack.appendChild(row);
        });
    },
    resetVideo() {
        el.playerVideo.hidden = true; try { el.playerVideo.pause(); } catch {} el.playerVideo.removeAttribute('src'); el.playerVideo.load();
        el.playerIframe.hidden = true; el.playerIframe.src = ''; el.detailBackdrop.hidden = false; el.detailHero.classList.remove('playing'); el.playerStatus.hidden = true;
    },
    close() { Player.flushProgress(); el.playerModal.hidden = true; el.body.style.overflow = ''; this.resetVideo(); if (state.currentView !== 'telegram') Netflix.render(); TVNav.refresh(); }
};

/* ===== Reproductores externos ===== */
const ExternalPlayers = {
    render(playable) {
        const box = el.playerOptions; box.innerHTML = '';
        if (!playable) { box.hidden = true; return; }
        const items = [];
        if (playable.aceUrl) {
            items.push(`<a class="opt-btn ace focusable" tabindex="0" href="${escapeHtml(playable.aceUrl)}">▶ AceStream</a>`);
            const id = (playable.aceUrl.match(/[0-9a-fA-F]{40}/) || [''])[0];
            if (id) items.push(`<a class="opt-btn focusable" tabindex="0" href="intent:#Intent;scheme=acestream;package=org.acestream.media;S.content_id=${id};end">AceStream (Android)</a>`);
            items.push(`<button class="opt-btn focusable" tabindex="0" data-copy="${escapeHtml(playable.aceUrl)}">Copiar enlace</button>`);
        }
        if (playable.externalUrl) {
            items.push(`<a class="opt-btn focusable" tabindex="0" href="${escapeHtml(playable.externalUrl)}" target="_blank" rel="noopener">Abrir enlace</a>`);
            items.push(`<a class="opt-btn focusable" tabindex="0" href="vlc://${escapeHtml(playable.externalUrl)}">Abrir en VLC</a>`);
            items.push(`<button class="opt-btn focusable" tabindex="0" data-copy="${escapeHtml(playable.externalUrl)}">Copiar enlace</button>`);
        }
        const isTgDoc = !!(playable.src && (playable.src.t === 'doc' || playable.src.t === 'l'));
        if (isTgDoc) items.push('<button class="opt-btn focusable" tabindex="0" id="openext-btn">▶ Abrir con reproductor externo</button>');
        if (!items.length) { box.hidden = true; return; }
        const label = playable.aceUrl ? 'Enlace AceStream:'
            : (isTgDoc && playable.playableInBrowser === false ? 'Este formato (mkv/avi) no se reproduce en el navegador. Ábrelo en otra app/reproductor:' : 'Más opciones:');
        box.hidden = false; box.innerHTML = `<div class="opt-label">${escapeHtml(label)}</div><div class="opt-row">${items.join('')}</div>`;
        $$('button[data-copy]', box).forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => { b.innerText = '¡Copiado!'; setTimeout(() => b.innerText = 'Copiar enlace', 1500); }).catch(() => {}));
        const oe = $('#openext-btn', box); if (oe) oe.onclick = () => Player.openExternalApp(playable);
    }
};

/* ===== Reproductor ===== */
const Player = {
    current: null,
    async play(playable, parent) {
        if (!playable) return;
        this.flushProgress();
        this.current = { playable, parent };
        if (parent && parent.episodes && parent.episodes.length > 1) Store.setLastEp(parent.id, playable.id);
        const src = playable.src;
        if (!src || src.ace) { el.detailHero.classList.remove('playing'); el.detailBackdrop.hidden = false; el.playerStatus.hidden = false; el.playerStatus.innerText = src && src.ace ? 'Contenido AceStream: ábrelo con el botón de abajo.' : 'No reproducible.'; ExternalPlayers.render(playable); return; }
        if (src.ext) { el.detailHero.classList.add('playing'); el.detailBackdrop.hidden = true; el.playerVideo.hidden = true; el.playerIframe.hidden = false; el.playerIframe.src = this.embed(src.ext); return; }
        el.detailHero.classList.add('playing'); el.detailBackdrop.hidden = true;
        el.playerIframe.hidden = true; el.playerIframe.src = '';
        el.playerStatus.hidden = false; el.playerStatus.innerText = 'Cargando vídeo...';
        Player._lastError = '';
        try {
            let url;
            if (src.t === 'url') url = src.url;
            else {
                const okSW = await SW.ensure();
                if (!okSW) { Player._lastError = 'No se pudo activar el streaming (Service Worker).'; return this.onError(playable); }
                const r = await Engine.prepareStream(src);
                SW.register(r.streamId, r.size, r.mime);
                url = r.url;
            }
            const v = el.playerVideo;
            v.hidden = false; v.src = url;
            const resume = (Store.progress[playable.id] || {}).time || 0;
            v.onloadedmetadata = () => { if (resume > 8 && resume < v.duration - 5) v.currentTime = resume; };
            const hide = () => { el.playerStatus.hidden = true; Player._clearWatch(); };
            v.onplaying = hide; v.onloadeddata = hide; v.oncanplay = hide;
            v.onerror = () => this.streamFailed(playable);
            v.ontimeupdate = () => this._tick();
            v.onended = () => Store.clearProgress(playable.id);
            this._clearWatch();
            this._watch = setTimeout(() => {
                if (v.readyState < 2 && !v.error) this.streamFailed(playable);
            }, 11000);
            v.play().catch(() => {});
        } catch (e) { console.error(e); Player._lastError = e.message || String(e); this.streamFailed(playable); }
    },
    _watch: null, _lastError: '',
    _clearWatch() { if (this._watch) { clearTimeout(this._watch); this._watch = null; } },
    streamFailed(playable) {
        this._clearWatch();
        // No descargamos la peli entera (eso causaba "cargando" infinito).
        // Mostramos el motivo y las opciones (abrir con reproductor externo).
        this.onError(playable);
    },
    onError(playable) {
        el.detailHero.classList.remove('playing'); el.detailBackdrop.hidden = false;
        el.playerStatus.hidden = false;
        el.playerStatus.innerText = 'No se pudo reproducir.' + (Player._lastError ? ' Motivo: ' + Player._lastError + '.' : '') + ' Usa "Abrir con reproductor externo" (abajo).';
        ExternalPlayers.render(playable);
    },
    async downloadAndPlay(playable) {
        this._clearWatch();
        el.detailHero.classList.add('playing'); el.detailBackdrop.hidden = true;
        el.playerStatus.hidden = false; el.playerStatus.innerText = 'Preparando vídeo... (descarga directa)';
        try {
            const url = await Engine.downloadFull(playable.src, (d, t) => { if (t) el.playerStatus.innerText = 'Cargando ' + Math.round(d / t * 100) + '%'; });
            const v = el.playerVideo;
            v.hidden = false;
            v.onerror = () => this.onError(playable);
            v.onplaying = () => { el.playerStatus.hidden = true; };
            v.src = url; v.play().catch(() => {});
        } catch (e) { Player._lastError = e.message || String(e); this.onError(playable); }
    },
    async openExternalApp(playable) {
        el.detailHero.classList.remove('playing'); el.detailBackdrop.hidden = false;
        el.playerStatus.hidden = false; el.playerStatus.innerText = 'Preparando vídeo... 0%';
        let data;
        try {
            data = await Engine.downloadBlob(playable.src, (d, t) => { if (t) el.playerStatus.innerText = 'Preparando vídeo... ' + Math.round(d / t * 100) + '%'; });
        } catch (e) { el.playerStatus.innerText = 'No se pudo preparar: ' + (e.message || e); return; }
        const file = new File([data.blob], data.name, { type: data.mime });
        const url = URL.createObjectURL(data.blob);
        // Mostramos botones: la apertura/compartición DEBE ir en un toque del usuario
        el.playerStatus.innerHTML = 'Vídeo listo (' + escapeHtml(data.name) + '). Ábrelo con tu reproductor:<br><br>'
            + '<button id="x-share" class="opt-btn focusable" tabindex="0">▶ Abrir con reproductor externo</button> '
            + '<a id="x-open" class="opt-btn focusable" tabindex="0" href="' + url + '" target="_blank" rel="noopener">Abrir en pestaña</a>';
        const share = document.getElementById('x-share');
        share.onclick = async () => {
            try {
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({ files: [file], title: data.name });
                } else {
                    window.open(url, '_blank');
                }
            } catch (e) { try { window.open(url, '_blank'); } catch {} }
        };
        setTimeout(() => share.focus(), 30);
    },
    _last: 0,
    _tick() { const v = el.playerVideo, c = this.current; if (!c || !v.duration) return; const n = Date.now(); if (n - this._last > 5000) { this._last = n; Store.saveProgress(c.playable, c.parent, v.currentTime, v.duration); } },
    flushProgress() { const v = el.playerVideo, c = this.current; if (c && !v.hidden && v.currentTime > 8 && v.duration) Store.saveProgress(c.playable, c.parent, v.currentTime, v.duration); },
    embed(url) { try { const u = new URL(url); if (u.hostname.includes('youtu')) { const id = u.searchParams.get('v') || u.pathname.split('/').pop(); return 'https://www.youtube.com/embed/' + id; } } catch {} return url; }
};

/* ===== LOGIN ===== */
const Login = {
    open() { el.loginModal.hidden = false; el.body.style.overflow = 'hidden'; this.step('phone'); this.msg(''); },
    step(s) { $$('#login-modal .login-step').forEach(x => x.hidden = x.dataset.step !== s); },
    msg(t) { const n = $('#login-status'); if (n) n.innerText = t || ''; },
    async sendCode() { const phone = $('#login-phone').value.trim(); if (!phone) return this.msg('Escribe tu número con prefijo (ej: +34...).'); this.msg('Enviando código...'); try { await Engine.sendCode(phone); this.msg('Código enviado. Míralo en tu Telegram.'); this.step('code'); $('#login-code').focus(); } catch (e) { this.msg(e.errorMessage || e.message); } },
    async verifyCode() { const code = $('#login-code').value.trim(); if (!code) return this.msg('Escribe el código.'); this.msg('Verificando...'); try { const r = await Engine.signIn(code); if (r.needPassword) { this.msg('Tu cuenta tiene 2FA.'); this.step('password'); $('#login-password').focus(); } else location.reload(); } catch (e) { this.msg(e.errorMessage || e.message); } },
    async verifyPassword() { const p = $('#login-password').value; if (!p) return this.msg('Escribe tu contraseña 2FA.'); this.msg('Comprobando...'); try { await Engine.signInPassword(p); location.reload(); } catch (e) { this.msg(e.errorMessage || e.message); } }
};

/* ===== Cuenta / admin ===== */
const Admin = {
    async logout() { if (!confirm('¿Cerrar tu sesión de Telegram en esta web?')) return; try { await Engine.logout(); } catch {} location.reload(); },
    refresh() { location.reload(); },
    reflect() { const a = !!state.isAdmin; el.navTelegram.hidden = !a; if (el.viewSwitch) el.viewSwitch.hidden = !a; el.adminRefresh.hidden = !a; el.adminLock.hidden = false; }
};

/* ===== CHAT (admin) ===== */
const Chat = {
    async load() { try { state.topics = await Engine.getAutoTopics(); } catch (e) { el.chatList.innerHTML = `<div class="chat-empty">${escapeHtml(e.message)}</div>`; return; } this.renderList(); },
    renderList() {
        el.chatList.innerHTML = '';
        if (!state.topics.length) { el.chatList.innerHTML = '<div class="chat-empty" style="padding:2rem 1rem">No hay temas.</div>'; return; }
        state.topics.forEach(t => { const item = document.createElement('div'); item.className = 'chat-item is-media focusable'; item.tabIndex = 0; item.innerHTML = `<div class="chat-avatar">${t.icon || '#'}</div><div class="chat-item-body"><div class="chat-item-top"><span class="chat-item-name">${escapeHtml(t.name || t.title)}</span></div><div class="chat-item-sub">Tema</div></div>`; item.onclick = () => this.open(t, item); el.chatList.appendChild(item); });
        TVNav.refresh();
    },
    async open(topic, node) {
        state.activeTopic = topic.id;
        $$('.chat-item', el.chatList).forEach(c => c.classList.remove('active')); if (node) node.classList.add('active');
        el.chatHeaderTitle.innerText = topic.name || topic.title; el.chatHeaderMeta.innerText = 'cargando...';
        el.chatMessages.innerHTML = '<div class="chat-loading"><div class="loader small"></div></div>';
        let msgs; try { msgs = await Engine.getChatMessages(topic.id); } catch (e) { el.chatMessages.innerHTML = '<div class="chat-empty">Error: ' + escapeHtml(e.message) + '</div>'; return; }
        el.chatHeaderMeta.innerText = msgs.length + ' mensajes'; this.renderMessages(msgs, topic);
    },
    renderMessages(msgs, topic) {
        el.chatMessages.innerHTML = '';
        const ordered = msgs.slice().reverse();
        if (!ordered.length) { el.chatMessages.innerHTML = '<div class="chat-empty">No hay mensajes.</div>'; return; }
        ordered.forEach(m => {
            const b = document.createElement('div'); b.className = 'tg-message';
            const media = m.hasMedia ? `<div class="tg-media"><span class="tg-media-icon">${m.isVideo ? '▶' : '🖼'}</span></div>` : '';
            b.innerHTML = `<div class="tg-bubble">${media}${m.text ? `<div class="tg-text">${this.linkify(escapeHtml(m.text))}</div>` : ''}
                <div class="tg-actions"><button class="tg-edit focusable" tabindex="0">✎ Editar</button><button class="tg-del focusable" tabindex="0">🗑 Borrar</button></div>
                <div class="tg-time">${fmtTime(m.date)}</div></div>`;
            const mediaEl = b.querySelector('.tg-media'); if (mediaEl && m.thumb) Engine.getThumb(m.thumb).then(u => { if (u) mediaEl.style.backgroundImage = `url(${u})`; });
            $('.tg-edit', b).onclick = () => this.edit(topic, m);
            $('.tg-del', b).onclick = () => this.del(topic, m);
            el.chatMessages.appendChild(b);
        });
        el.chatMessages.scrollTop = el.chatMessages.scrollHeight; TVNav.refresh();
    },
    async edit(topic, m) { const text = prompt('Editar mensaje:', m.text || ''); if (text == null) return; try { await Engine.editMessage(m.id, text); this.open(topic); } catch (e) { alert('Error al editar: ' + e.message); } },
    async del(topic, m) { if (!confirm('¿Borrar este mensaje del grupo?')) return; try { await Engine.deleteMessage(m.id); this.open(topic); } catch (e) { alert('Error al borrar: ' + e.message); } },
    linkify(t) { return t.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
};

/* ===== APP / búsqueda ===== */
const App = {
    switchView(view) {
        state.currentView = view; const isNet = view === 'netflix';
        el.netflixView.hidden = !isNet; el.telegramView.hidden = isNet;
        el.body.classList.toggle('telegram-mode', !isNet);
        el.navNetflix.classList.toggle('active', isNet); el.navTelegram.classList.toggle('active', !isNet);
        if (!isNet) Chat.load().then(() => { if (!state.activeTopic && state.topics.length) Chat.open(state.topics[0], $$('.chat-item', el.chatList)[0]); });
        TVNav.refresh();
    },
    search() {
        const q = (el.searchInput.value || '').trim().toLowerCase(), genre = (el.filterGenre.value || '').toLowerCase(), year = el.filterYear.value || '';
        if (!q && !genre && !year) { el.searchResults.innerHTML = ''; return; }
        const res = state.allItems.filter(it => {
            const okText = !q || (it.title || '').toLowerCase().includes(q) || (it.description || '').toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q);
            const okG = !genre || ((it.meta && it.meta.genres) || '').toLowerCase().includes(genre);
            const okY = !year || String(it.year) === year; return okText && okG && okY;
        });
        if (!res.length) { el.searchResults.innerHTML = '<div class="search-empty">Sin resultados.</div>'; return; }
        el.searchResults.innerHTML = '';
        res.forEach(it => { const c = document.createElement('div'); c.className = 'search-card focusable'; c.tabIndex = 0; c.innerHTML = `<img class="search-image" src="${placeholderImage(it.id, it.title)}" alt=""><div class="search-meta"><h3>${escapeHtml(it.title)}</h3><p>${escapeHtml((it.description || '').slice(0, 140))}</p><span class="search-cat">${escapeHtml(it.category || '')}</span></div>`; loadThumb($('.search-image', c), it.thumb, it.id, it.title); c.onclick = () => { this.closeSearch(); Detail.open(it); }; el.searchResults.appendChild(c); });
        TVNav.refresh();
    },
    populateFilters() {
        const genres = new Set(), years = new Set();
        state.allItems.forEach(it => { if (it.meta && it.meta.genres) it.meta.genres.split(/[,/]/).forEach(g => { const t = g.trim(); if (t) genres.add(t); }); if (it.year) years.add(String(it.year)); });
        el.filterGenre.innerHTML = '<option value="">Todos los géneros</option>' + [...genres].sort().map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
        el.filterYear.innerHTML = '<option value="">Todos los años</option>' + [...years].sort((a, b) => b - a).map(y => `<option value="${y}">${y}</option>`).join('');
    },
    openSearch() { el.searchOverlay.hidden = false; el.searchInput.value = ''; el.searchResults.innerHTML = ''; el.searchInput.focus(); el.body.style.overflow = 'hidden'; },
    closeSearch() { el.searchOverlay.hidden = true; el.searchInput.value = ''; el.filterGenre.value = ''; el.filterYear.value = ''; el.searchResults.innerHTML = ''; el.body.style.overflow = ''; }
};

/* ===== Navegación TV Box ===== */
const TVNav = {
    SEL: '.card, .card-remove, .btn, .episode, .chat-item, .opt-btn, .source-btn, .filter-select, .nav-links a, .view-btn, .icon-btn, .search-btn, .slider-arrow, .search-card, #search-input, .tg-edit, .tg-del, .modal-close, .login-input, .login-action, .btn-link',
    refresh() { $$(this.SEL).forEach(e => { if (e.tabIndex < 0) e.tabIndex = 0; }); },
    scope() { if (!el.loginModal.hidden) return el.loginModal; if (!el.playerModal.hidden) return el.playerModal; if (!el.searchOverlay.hidden) return el.searchOverlay; return document; },
    focusables() { const root = this.scope(); return $$(this.SEL, root === document ? document : root).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.disabled; }); },
    move(dir) {
        const list = this.focusables(); if (!list.length) return;
        const cur = document.activeElement; if (!cur || !list.includes(cur)) { list[0].focus(); return; }
        const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let best = null, score = Infinity;
        for (const e of list) { if (e === cur) continue; const b = e.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2; const dx = bx - cx, dy = by - cy; let ok, p, s; if (dir === 'right') { ok = dx > 8; p = dx; s = Math.abs(dy); } else if (dir === 'left') { ok = dx < -8; p = -dx; s = Math.abs(dy); } else if (dir === 'down') { ok = dy > 8; p = dy; s = Math.abs(dx); } else { ok = dy < -8; p = -dy; s = Math.abs(dx); } if (!ok) continue; const sc = p + s * 2.2; if (sc < score) { score = sc; best = e; } }
        if (best) { best.focus(); best.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }
    },
    init() {
        document.addEventListener('keydown', (e) => {
            const k = e.key;
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
                if ((k === 'ArrowLeft' || k === 'ArrowRight') && (document.activeElement === el.searchInput || (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('login-input')))) return;
                e.preventDefault(); this.move(k.replace('Arrow', '').toLowerCase());
            } else if (k === 'Enter') { const a = document.activeElement; if (a && a.tagName !== 'INPUT' && a.click) { e.preventDefault(); a.click(); } }
            else if (k === 'Backspace' || k === 'GoBack' || k === 'BrowserBack') { if (document.activeElement && document.activeElement.tagName === 'INPUT') return; if (!el.playerModal.hidden) { e.preventDefault(); Detail.close(); } else if (!el.searchOverlay.hidden) { e.preventDefault(); App.closeSearch(); } }
        });
    }
};

/* ===== Service Worker (streaming por rangos, puerto persistente) ===== */
const SW = {
    port: null, ready: false, _initing: null,
    async ensure() {
        if (!('serviceWorker' in navigator)) return false;
        if (this.ready && navigator.serviceWorker.controller) return true;
        if (this._initing) return this._initing;
        this._initing = (async () => {
            try {
                const reg = await navigator.serviceWorker.register('sw.js');
                try { reg.update(); } catch {}
                await navigator.serviceWorker.ready;
                if (!navigator.serviceWorker.controller) {
                    await Promise.race([
                        new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true })),
                        new Promise(r => setTimeout(r, 3000))
                    ]);
                }
                const ctrl = navigator.serviceWorker.controller;
                if (!ctrl) { this._initing = null; return false; }
                await new Promise((resolve) => {
                    const ch = new MessageChannel();
                    this.port = ch.port1;
                    this.port.onmessage = (ev) => this._onMsg(ev);
                    const done = () => { this.ready = true; resolve(); };
                    this._readyResolve = done;
                    ctrl.postMessage({ type: 'INIT' }, [ch.port2]);
                    setTimeout(done, 1500);
                });
                this._initing = null;
                return true;
            } catch (e) { console.warn('SW', e.message); this._initing = null; return false; }
        })();
        return this._initing;
    },
    async _onMsg(ev) {
        const d = ev.data || {};
        if (d.type === 'READY') { if (this._readyResolve) this._readyResolve(); return; }
        if (d.type === 'FETCH_RANGE') {
            try {
                const { chunk } = await Engine.streamRange(d.streamId, d.start, d.start + d.size - 1);
                const buf = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
                this.port.postMessage({ requestId: d.requestId, chunk: buf }, [buf]);
            } catch (err) { Player._lastError = err && (err.message || String(err)); this.port.postMessage({ requestId: d.requestId, error: Player._lastError || 'error' }); }
        }
    },
    register(streamId, fileSize, mimeType) {
        const ctrl = navigator.serviceWorker.controller;
        if (ctrl) ctrl.postMessage({ type: 'REGISTER', streamId, fileSize, mimeType });
    }
};

async function boot() {
    try {
        if (window.CONFIG && window.CONFIG.appName) { el.brand.innerText = window.CONFIG.appName.toUpperCase(); document.title = window.CONFIG.appName; }
        await SW.ensure();
        el.loadingText.innerText = 'Conectando con Telegram...';
        const authorized = await Engine.init(window.CONFIG);
        if (!authorized) { el.loadingScreen.classList.add('hidden'); Login.open(); return; }
        state.isAdmin = Engine.isAdmin; Admin.reflect();
        el.loadingText.innerText = 'Cargando catálogo...';
        const catalog = await Engine.getCatalog();
        state.catalog = catalog;
        catalog.categories.forEach(c => c.items.forEach(it => { it.category = c.name; state.allItems.push(it); state.itemsById[it.id] = it; }));
        App.populateFilters(); Netflix.render(); App.switchView('netflix');
        setTimeout(() => { const f = $('.card'); if (f) f.focus(); }, 200);
    } catch (e) {
        console.error(e);
        el.rowsContainer.innerHTML = `<div class="empty-state">No se pudo cargar.<br>${escapeHtml(e.message)}<br><br>
            <button class="btn btn-play" onclick="location.reload()" style="display:inline-flex">Reintentar</button></div>`;
        el.netflixView.hidden = false;
    } finally { el.loadingScreen.classList.add('hidden'); }
}

function wireUi() {
    el.navNetflix.onclick = (e) => { e.preventDefault(); App.switchView('netflix'); };
    el.navTelegram.onclick = (e) => { e.preventDefault(); App.switchView('telegram'); };
    el.adminLock.onclick = () => Admin.logout();
    el.adminRefresh.onclick = () => Admin.refresh();
    $('.modal-close', el.playerModal).onclick = () => Detail.close();
    $('.modal-overlay', el.playerModal).onclick = () => Detail.close();
    el.searchBtn.onclick = () => App.openSearch();
    $('.search-close', el.searchOverlay).onclick = () => App.closeSearch();
    el.searchInput.addEventListener('input', () => App.search());
    el.filterGenre.addEventListener('change', () => App.search());
    el.filterYear.addEventListener('change', () => App.search());
    $('#btn-send-code').onclick = () => Login.sendCode();
    $('#btn-verify-code').onclick = () => Login.verifyCode();
    $('#btn-verify-password').onclick = () => Login.verifyPassword();
    $('#btn-back-phone').onclick = () => Login.step('phone');
    $('#login-phone').addEventListener('keydown', e => { if (e.key === 'Enter') Login.sendCode(); });
    $('#login-code').addEventListener('keydown', e => { if (e.key === 'Enter') Login.verifyCode(); });
    $('#login-password').addEventListener('keydown', e => { if (e.key === 'Enter') Login.verifyPassword(); });
    el.navLinks.addEventListener('click', (e) => { const a = e.target.closest('a[data-cat]'); if (!a) return; e.preventDefault(); $$('#nav-links a').forEach(x => x.classList.remove('active')); a.classList.add('active'); if (!a.dataset.cat) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; } const row = $$('.row-title').find(t => t.innerText.includes(a.dataset.cat)); if (row) row.closest('.content-row').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (!el.searchOverlay.hidden) App.closeSearch(); else if (!el.playerModal.hidden) Detail.close(); });
    window.addEventListener('scroll', () => { el.navbar.classList.toggle('scrolled', window.scrollY > 50); });
    el.navTelegram.hidden = true;
    TVNav.init();
}

document.addEventListener('DOMContentLoaded', () => { wireUi(); boot(); });
