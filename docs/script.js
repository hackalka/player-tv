/* =====================================================================
 * script.js — Versión Final: Shaka Player + Prioridad ExoPlayer (Blindado)
 * ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    try { 
        const t = localStorage.getItem('tvp_token'); 
        if (t) headers['x-auth-token'] = t; 
    } catch {}
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
        const url = playable.streamUrl || playable.externalUrl || '';

        // BLINDAJE: Si ArtPlayer creó contenedores o capas encima del video, los eliminamos
        const container = $('[data-shaka-player-container]');
        if (container) {
            // Eliminamos elementos extraños que no sean el tag <video> (ej. divs creados por ArtPlayer)
            Array.from(container.children).forEach(child => {
                if (child.tagName !== 'VIDEO') child.remove();
            });
        }

        // 1. PRIORIDAD NATIVA (Para pantalla completa real en APK - ExoPlayer / VLC)
        if (window.NativeHost && NativeHost.isAvailable()) {
            const title = (parent && parent.title) || playable.title || '';
            const engine = url.includes('.mp4') ? 'exo' : 'vlc';
            NativeHost.playUrl(url, title, "video/mp4", engine);
            return;
        }

        // 2. WEB: SHAKA PLAYER (Con pantalla completa HTML5 nativa)
        const video = el.playerVideo;
        if (video) {
            video.style.display = 'block'; // Asegurar que el video sea visible
        }

        if (!this.shaka && video) {
            this.shaka = new shaka.Player(video);
            // Configuración para forzar controles nativos y pantalla completa nativa en móviles
            this.shaka.configure({
                streaming: {
                    lowLatencyMode: true
                }
            });
        }
        
        el.detailHero.classList.add('playing');
        try {
            await this.shaka.load(url);
            video.play();
            
            // Forzar pantalla completa en navegadores móviles/web si no es APK
            if (video.requestFullscreen) {
                video.requestFullscreen();
            } else if (video.webkitRequestFullscreen) {
                video.webkitRequestFullscreen(); // Safari / iOS
            }
        } catch (e) {
            // Fallback si falla Shaka
            if (video) {
                video.src = url; 
                video.play();
            }
        }
    }
};

const Detail = {
    current: null,
    open(item) {
        this.current = item;
        const ov = Store.overrides[item.id] || {};
        $('#modal-title').innerText = ov.title || item.title;
        $('#modal-description').innerText = ov.desc || item.description || '';
        el.playerModal.hidden = false;

        if (state.isAdmin && el.adminFab) {
            el.adminFab.hidden = false;
        } else if (el.adminFab) {
            el.adminFab.hidden = true;
        }
        
        // Asignación directa con prioridad alta para el botón de reproducir
        const playBtn = $('#detail-play');
        if (playBtn) {
            playBtn.onclick = (e) => {
                // Evitamos que tg-app.js u otros scripts intercepten el clic para meter ArtPlayer
                e.preventDefault();
                e.stopImmediatePropagation();
                Player.play(item.episodes ? item.episodes[0] : item, item);
            };
        }
    },
    close() { 
        el.playerModal.hidden = true; 
        if (el.playerVideo) {
            el.playerVideo.pause(); 
            el.playerVideo.removeAttribute('src');
        }
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
                card.onclick = (e) => {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    Detail.open(it);
                };
                track.appendChild(card);
            });
            el.rowsContainer.appendChild(row);
        });
    }
};

async function boot() {
    try {
        const me = await api('/api/me');
        state.isAdmin = me.isAdmin;
        state.catalog = await api('/api/catalog');
        Netflix.render();
    } catch (error) {
        console.error("Error durante el arranque:", error);
    } finally {
        const loader = $('#loading-screen');
        if (loader) loader.hidden = true;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    boot();
    $('.modal-close').onclick = () => Detail.close();
    $('#admin-fab-toggle').onclick = () => el.adminFabMenu.hidden = !el.adminFabMenu.hidden;

    const addEpBtn = $('#add-episode-btn');
    if (addEpBtn) {
        addEpBtn.onclick = () => {
            if (Detail.current && state.isAdmin) {
                const u = prompt('Enlace del capítulo:');
                if (u) { 
                    const eps = Detail.current.episodes || [];
                    eps.push({ title: 'Capítulo ' + (eps.length + 1), streamUrl: u });
                    Store.setOverride(Detail.current.id, { episodes: eps });
                    Detail.open(Detail.current);
                }
            }
        };
    }
});
