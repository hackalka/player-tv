/* =====================================================================
 * Tv Player — frontend (Versión Corregida: Shaka + ExoPlayer)
 * ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const PLACEHOLDER_COLORS = ['#0a1a3a', '#0f2027', '#1a2a6c'];
function placeholderImage(seed, label) {
    const color = PLACEHOLDER_COLORS[Math.abs(hashCode(String(seed))) % PLACEHOLDER_COLORS.length];
    const txt = (label || 'TV').slice(0, 16);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='600'><rect width='100%' height='100%' fill='${color}'/><text x='50%' y='50%' fill='rgba(255,255,255,.85)' font-family='Arial' font-size='26' font-weight='bold' text-anchor='middle' dominant-baseline='middle'>${escapeXml(txt)}</text></svg>`;
    try { return 'data:image/svg+xml,' + encodeURIComponent(svg); }
    catch (e) { return ''; }
}
function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h; }
function escapeXml(s) { return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])); }
function escapeHtml(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
function fmtTime(d) { try { return new Date(d * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
function absUrl(p) { return p ? new URL(p, location.href).href : ''; }

async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    try { const t = localStorage.getItem('tvp_token'); if (t) headers['x-auth-token'] = t; } catch {}
    let r = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
    let data = await r.json().catch(() => ({}));
    if (r.status === 401 || (data && data.needLogin)) { location.reload(); throw new Error('Sesión expirada'); }
    if (!r.ok) throw new Error(data.error || ('Error ' + r.status));
    return data;
}

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
            parentId: (parent && parent.id) || playable.id, time, duration: duration || 0, updated: Date.now()
        };
        this.progress = p;
    },
    continueList() { return Object.values(this.progress).filter(r => r.time > 8 && (!r.duration || r.time < r.duration * 0.95)).sort((a, b) => b.updated - a.updated).slice(0, 20); },
    isFav(id) { return !!this.favs[id]; },
    toggleFav(item) { const f = this.favs; if (f[item.id]) delete f[item.id]; else f[item.id] = item; this.favs = f; return !!f[item.id]; },
    favList() { return Object.values(this.favs).reverse(); },
    setLastEp(seriesId, epId) { const l = this.lastEp; l[seriesId] = epId; this.lastEp = l; },
    get volume() { const v = parseFloat(localStorage.getItem('tvp_vol')); return isNaN(v) ? 1 : v; },
    set volume(v) { localStorage.setItem('tvp_vol', String(v)); },
    get overrides() { return this._get('tvp_overrides', {}); },
    set overrides(v) { this._set('tvp_overrides', v); },
    getOverride(id) { return this.overrides[id] || {}; },
    setOverride(id, patch) {
        const o = this.overrides;
        const cur = Object.assign({}, o[id], patch);
        Object.keys(cur).forEach(k => { if (cur[k] === '' || cur[k] == null) delete cur[k]; });
        if (Object.keys(cur).length) o[id] = cur; else delete o[id];
        this.overrides = o;
    },
    get covers() { return this._get('tvp_covers', {}); },
    setCover(id, url) { const c = this.covers; if (url) c[id] = url; else delete c[id]; this._set('tvp_covers', c); },
    getCover(id) { return this.covers[id] || ''; }
};

const CloudStore = {
    init() {}, syncFavs() {}, saveFavs() {}, syncProgress() {}, saveProgress() {}, saveOverrides() {}, saveCovers() {}
};

const state = { catalog: { categories: [] }, allItems: [], itemsById: {}, isAdmin: false };

const el = {
    body: document.body,
    netflixView: $('#netflix-view'),
    navLinks: $('#nav-links'),
    rowsContainer: $('#rows-container'),
    playerModal: $('#player-modal'),
    playerVideo: $('#player-video'),
    detailHero: $('#detail-hero'),
    detailBackdrop: $('#detail-backdrop'),
    modalTitle: $('#modal-title'),
    modalDescription: $('#modal-description'),
    episodeList: $('#episode-list'),
    episodesTrack: $('#episodes-track'),
    detailPlay: $('#detail-play'),
    favBtn: $('#fav-btn'),
    adminFab: $('#admin-fab'),
    adminFabToggle: $('#admin-fab-toggle'),
    adminFabMenu: $('#admin-fab-menu')
};

const Netflix = {
    _vis(items) { return (items || []); },
    render() {
        el.rowsContainer.innerHTML = '';
        const cont = Store.continueList();
        if (cont.length) el.rowsContainer.appendChild(this.row('▶ Continuar viendo', cont, 'continue'));
        const favs = Store.favList();
        if (favs.length) el.rowsContainer.appendChild(this.row('❤ Mi lista', favs));

        state.catalog.categories.forEach(c => {
            if (c.items && c.items.length) el.rowsContainer.appendChild(this.row(c.name, c.items));
        });
    },
    row(title, items, kind) {
        const row = document.createElement('section');
        row.className = 'content-row';
        row.innerHTML = `<div class="row-header"><h2 class="row-title">${escapeHtml(title)}</h2></div><div class="row-slider"><div class="slider-track"></div></div>`;
        const track = $('.slider-track', row);
        items.forEach(it => track.appendChild(this.card(it, kind)));
        return row;
    },
    card(item, kind) {
        const card = document.createElement('div');
        card.className = 'card focusable'; card.tabIndex = 0;
        const ov = Store.getOverride(item.id);
        const title = ov.title || item.title || '';
        const img = Store.getCover(item.id) || ov.backdrop || item.thumbUrl || placeholderImage(item.id, title);
        card.innerHTML = `<img class="card-image" src="${img}"><div class="card-overlay"><h3 class="card-title">${escapeHtml(title)}</h3></div>`;
        card.onclick = () => Detail.open(item);
        return card;
    }
};

const Detail = {
    current: null,
    open(item) {
        this.current = item;
        const ov = Store.getOverride(item.id);
        el.modalTitle.innerText = ov.title || item.title;
        el.modalDescription.innerText = ov.desc || item.description || 'Sin descripción.';
        el.detailBackdrop.src = Store.getCover(item.id) || ov.backdrop || item.thumbUrl || placeholderImage(item.id, item.title);
        
        el.playerModal.hidden = false;
        this.resetVideo();
        
        const eps = item.episodes || [];
        if (eps.length > 1) {
            el.episodeList.hidden = false;
            this.renderEpisodes(eps, item);
        } else {
            el.episodeList.hidden = true;
        }

        // Admin Buttons
        if (state.isAdmin) {
            el.adminFab.hidden = false;
            $('#add-episode-btn').hidden = !item.isSeries;
            $('#edit-episodes-btn').hidden = !item.isSeries;
            
            $('#title-btn').onclick = () => {
                const t = prompt('Nuevo título:', ov.title || item.title);
                if (t !== null) { Store.setOverride(item.id, { title: t }); Detail.open(item); Netflix.render(); }
            };
            $('#video-link-btn').onclick = () => {
                const v = prompt('Enlace del vídeo:', ov.videoUrl || '');
                if (v !== null) { Store.setOverride(item.id, { videoUrl: v }); Detail.open(item); }
            };
            $('#add-episode-btn').onclick = () => {
                const url = prompt('Enlace del capítulo:');
                if (!url) return;
                const eps = ov.episodes || [];
                eps.push({ title: 'Capítulo ' + (eps.length + 1), url });
                Store.setOverride(item.id, { episodes: eps });
                Detail.open(item);
            };
        }

        el.detailPlay.onclick = () => Player.play(eps[0] || item, item);
    },
    renderEpisodes(eps, parent) {
        el.episodesTrack.innerHTML = '';
        eps.forEach(ep => {
            const div = document.createElement('div');
            div.className = 'episode focusable'; div.tabIndex = 0;
            div.innerText = ep.title;
            div.onclick = () => Player.play(ep, parent);
            el.episodesTrack.appendChild(div);
        });
    },
    resetVideo() {
        const v = el.playerVideo;
        v.pause(); v.removeAttribute('src'); v.load();
        el.detailHero.classList.remove('playing');
    },
    close() { el.playerModal.hidden = true; this.resetVideo(); }
};

const Player = {
    shaka: null,
    async play(playable, parent) {
        if (!playable) return;
        const ov = Store.getOverride(parent.id);
        const url = ov.videoUrl || playable.streamUrl || playable.externalUrl;

        // 1. PRIORIDAD NATIVA (APK) para Pantalla Completa Real
        if (this._hasNative()) {
            if (this._playNative(playable, parent, url)) return;
        }

        // 2. WEB: SHAKA PLAYER
        const video = el.playerVideo;
        if (!this.shaka) this.shaka = new shaka.Player(video);
        
        el.detailHero.classList.add('playing');
        try {
            await this.shaka.load(url);
            video.play();
        } catch (e) {
            video.src = url; video.play();
        }
    },
    _hasNative() { return !!(window.NativeHost && NativeHost.isAvailable()); },
    _playNative(playable, parent, url) {
        try {
            const title = (parent && parent.title) || playable.title || '';
            // Enviar al reproductor de Android (ExoPlayer/VLC)
            NativeHost.playUrl(url, title, "video/mp4", "exo");
            return true;
        } catch (e) { return false; }
    },
    flushProgress() {}
};

async function boot() {
    try {
        const me = await api('/api/me');
        state.isAdmin = !!me.isAdmin;
        const cat = await api('/api/catalog');
        state.catalog = cat;
        cat.categories.forEach(c => c.items.forEach(it => state.allItems.push(it)));
        Netflix.render();
    } catch (e) { console.error(e); }
}

document.addEventListener('DOMContentLoaded', () => {
    boot();
    $('.modal-close').onclick = () => Detail.close();
    if (el.adminFabToggle) el.adminFabToggle.onclick = () => el.adminFabMenu.hidden = !el.adminFabMenu.hidden;
});

window.TVPlus_onBack = () => { if (!el.playerModal.hidden) { Detail.close(); return true; } return false; };
