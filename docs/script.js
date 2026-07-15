/* =====================================================================
 * script.js — Versión Final Adaptada para ArtPlayer + Prioridad ExoPlayer
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
    async play(playable, parent) {
        if (!playable) return;
        const url = playable.streamUrl || playable.externalUrl || '';

        // 1. PRIORIDAD NATIVA (Para pantalla completa real en APK - ExoPlayer / VLC)
        if (window.NativeHost && NativeHost.isAvailable()) {
            const title = (parent && parent.title) || playable.title || '';
            const engine = url.includes('.mp4') ? 'exo' : 'vlc';
            NativeHost.playUrl(url, title, "video/mp4", engine);
            return;
        }

        // 2. BLINDAJE CSS ABSOLUTO (Evita que la imagen del poster tape los controles)
        // Forzamos a que, al reproducir, cualquier imagen de fondo o capa extraña en el hero se oculte
        if (el.detailHero) {
            el.detailHero.style.backgroundImage = 'none';
            el.detailHero.style.setProperty('background-image', 'none', 'important');
            el.detailHero.classList.add('playing');
        }

        // 3. INTEGRACIÓN COMPATIBLE CON ARTPLAYER
        if (window.art) {
            try {
                // Cambiamos el stream directamente en la instancia activa de ArtPlayer
                window.art.switchUrl(url);
                window.art.play();
                
                // Forzar que el contenedor físico de ArtPlayer esté al frente absoluto de interacción
                const artEl = $('.artplayer-app') || $('.art-video-player') || window.art.container;
                if (artEl) {
                    artEl.style.setProperty('z-index', '99999', 'important');
                    artEl.style.setProperty('position', 'relative', 'important');
                    artEl.style.setProperty('pointer-events', 'auto', 'important');
                }
                return;
            } catch (e) {
                console.log("No se pudo reusar la instancia global de ArtPlayer, aplicando fallback...", e);
            }
        }

        // 4. FALLBACK DE REPRODUCCIÓN ESTÁNDAR
        const video = el.playerVideo;
        if (video) {
            video.removeAttribute('poster');
            video.style.backgroundImage = 'none';
            video.style.backgroundColor = '#000';
            video.style.display = 'block';
            video.src = url;
            
            try {
                await video.play();
                if (video.requestFullscreen) video.requestFullscreen();
            } catch (err) {
                console.error("Error en reproducción fallback:", err);
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

        // Resetear visualización al abrir la ficha de detalles (antes de darle al play)
        if (el.playerVideo) {
            el.playerVideo.style.zIndex = '';
            if (item.thumbUrl) {
                el.playerVideo.setAttribute('poster', item.thumbUrl);
            }
        }
        
        // Al abrir detalles el hero muestra su fondo con normalidad
        if (el.detailHero) {
            el.detailHero.style.zIndex = '5'; 
            el.detailHero.style.position = 'relative';
            if (item.thumbUrl) {
                el.detailHero.style.backgroundImage = `url(${item.thumbUrl})`;
            }
        }

        if (state.isAdmin && el.adminFab) {
            el.adminFab.hidden = false;
        } else if (el.adminFab) {
            el.adminFab.hidden = true;
        }
        
        const playBtn = $('#detail-play');
        if (playBtn) {
            playBtn.onclick = (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();
                Player.play(item.episodes ? item.episodes[0] : item, item);
            };
        }
    },
    close() { 
        el.playerModal.hidden = true; 
        
        // Detener ArtPlayer de forma segura si está corriendo en la ventana
        if (window.art && typeof window.art.pause === 'function') {
            try { window.art.pause(); } catch {}
        }

        if (el.playerVideo) {
            el.playerVideo.pause(); 
            el.playerVideo.removeAttribute('src');
            el.playerVideo.removeAttribute('poster');
            el.playerVideo.style.backgroundImage = 'none';
        }
        if (el.detailHero) {
            el.detailHero.classList.remove('playing');
            el.detailHero.style.zIndex = '';
            el.detailHero.style.backgroundImage = 'none';
        }
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

    // Botón de tu panel Telegram Web Pro
    const tgBtn = $('#tg-personal-btn');
    if (tgBtn) {
        tgBtn.addEventListener('click', () => {
            if (window.TelegramWebPersonal) {
                window.TelegramWebPersonal.open();
            } else {
                console.error("El script 'tg-personal-admin.js' no está cargado correctamente.");
            }
        });
    }
});
