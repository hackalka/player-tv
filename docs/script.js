/* =====================================================================
 * script.js — Versión Final: Shaka Player + Prioridad ExoPlayer
 * ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    try { const t = localStorage.getItem('tvp_token'); if (t) headers['x-auth-token'] = t; } catch {}
    let r = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
    return await r.json();
}

const Store = {
    get progress() { try { return JSON.parse(localStorage.getItem('tvp_progress')) || {}; } catch { return {}; } },
    set progress(v) { localStorage.setItem('tvp_progress', JSON.stringify(v)); },
    get overrides() { try { return JSON.parse(localStorage.getItem('tvp_overrides')) || {}; } catch { return {}; } },
    setOverride(id, patch) {
        const o = this.overrides;
        o[id] = Object.assign({}, o[id], patch);
        localStorage.setItem('tvp_overrides', JSON.stringify(o));
    }
};

const state = { catalog: null, allItems: [], isAdmin: false };

const el = {
    netflixView: $('#netflix-view'),
    rowsContainer: $('#rows-container'),
    playerModal: $('#player-modal'),
    playerVideo: $('#player-video'),
    detailHero: $('#detail-hero'),
    adminFab: $('#admin-fab'),
    adminFabMenu: $('#admin-fab-menu')
};

const Player = {
    shaka: null,
    async play(playable, parent) {
        if (!playable) return;
        const url = playable.streamUrl || playable.externalUrl;

        // 1. PRIORIDAD NATIVA (Para pantalla completa real en APK)
        if (window.NativeHost && NativeHost.isAvailable()) {
            const title = (parent && parent.title) || playable.title || '';
            // Usamos ExoPlayer para MP4/WebM y VLC para el resto
            const engine = url.includes('.mp4') ? 'exo' : 'vlc';
            NativeHost.playUrl(url, title, "video/mp4", engine);
            return;
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
    }
};

const Detail = {
    open(item) {
        this.current = item;
        const ov = Store.overrides[item.id] || {};
        $('#modal-title').innerText = ov.title || item.title;
        $('#modal-description').innerText = ov.desc || item.description || '';
        el.playerModal.hidden = false;

        if (state.isAdmin) {
            el.adminFab.hidden = false;
            $('#add-episode-btn').onclick = () => {
                const u = prompt('Enlace del capítulo:');
                if (u) { 
                    const eps = item.episodes || [];
                    eps.push({title: 'Capítulo ' + (eps.length + 1), streamUrl: u});
                    Store.setOverride(item.id, { episodes: eps });
                    this.open(item);
                }
            };
        }
        $('#detail-play').onclick = () => Player.play(item.episodes ? item.episodes[0] : item, item);
    },
    close() { 
        el.playerModal.hidden = true; 
        el.playerVideo.pause(); 
        el.playerVideo.removeAttribute('src');
        el.detailHero.classList.remove('playing');
    }
};

const Netflix = {
    render() {
        el.rowsContainer.innerHTML = '';
        state.catalog.categories.forEach(c => {
            const row = document.createElement('section');
            row.className = 'content-row';
            row.innerHTML = `<h2 class="row-title">${c.name}</h2><div class="slider-track"></div>`;
            const track = row.querySelector('.slider-track');
            c.items.forEach(it => {
                const card = document.createElement('div');
                card.className = 'card';
                card.innerHTML = `<img src="${it.thumbUrl}"><div class="card-title">${it.title}</div>`;
                card.onclick = () => Detail.open(it);
                track.appendChild(card);
            });
            el.rowsContainer.appendChild(row);
        });
    }
};

async function boot() {
    const me = await api('/api/me');
    state.isAdmin = me.isAdmin;
    state.catalog = await api('/api/catalog');
    Netflix.render();
    $('#loading-screen').hidden = true;
}

document.addEventListener('DOMContentLoaded', () => {
    boot();
    $('.modal-close').onclick = () => Detail.close();
    $('#admin-fab-toggle').onclick = () => el.adminFabMenu.hidden = !el.adminFabMenu.hidden;
});
