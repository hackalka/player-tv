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
    async  play(playable, parent) {
        if (!playable) return;
        this.current = { playable, parent };
        const url = playable.streamUrl || playable.externalUrl;

        // 1. PRIORIDAD APK: Si detecta la APK, abre el Reproductor Nativo (ExoPlayer/VLC)
        // Esto garantiza PANTALLA COMPLETA real con el botón de Escala.
        if (this._hasNative() && playable.streamUrl) {
            if (this._playNative(playable, parent)) return;
        }

        // 2. BOTÓN TVGRAM: Ofrece abrir en TVGram Player si es un link de Telegram
        if (url.includes('tgstream')) {
            const tvgramBtn = document.createElement('button');
            tvgramBtn.className = 'opt-btn tvgram focusable';
            tvgramBtn.innerHTML = '📺 Abrir en TVGram Player (Mejor Calidad)';
            tvgramBtn.onclick = () => {
                const tme = ExternalPlayers.tmeLink(playable);
                window.location.href = 'tvgram://play?url=' + encodeURIComponent(tme);
            };
            $('#player-options').innerHTML = '';
            $('#player-options').appendChild(tvgramBtn);
        }

        // 3. WEB: Inicializar Video.js
        el.detailHero.classList.add('playing');
        const player = videojs('player-video');
        player.src({ src: url, type: url.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4' });
        player.play();
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
