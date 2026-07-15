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

        // 1. BLINDAJE ANTI-TEXTO CORRUPTO Y SVG ROTOs:
        // Buscamos y eliminamos cualquier nodo de texto plano con código SVG corrupto dentro del contenedor
        const container = $('[data-shaka-player-container]');
        if (container) {
            Array.from(container.childNodes).forEach(node => {
                // Eliminamos nodos de texto huérfanos que tengan trozos de código urlencodeado (como %22, %3C, rect, etc.)
                if (node.nodeType === Node.TEXT_NODE && (node.textContent.includes('%') || node.textContent.includes('<'))) {
                    node.remove();
                }
                // Limpieza de capas que no sean el video propiamente dicho o la interfaz de Shaka
                if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('shaka-controls-container') && node.tagName !== 'VIDEO') {
                    node.remove();
                }
            });
        }

        // 2. PRIORIDAD NATIVA (Para pantalla completa real en APK - ExoPlayer / VLC)
        if (window.NativeHost && NativeHost.isAvailable()) {
            const title = (parent && parent.title) || playable.title || '';
            const engine = url.includes('.mp4') ? 'exo' : 'vlc';
            NativeHost.playUrl(url, title, "video/mp4", engine);
            return;
        }

        // 3. WEB: SHAKA PLAYER (Con aislamiento y z-index corregido para que no se metan los textos)
        const video = el.playerVideo;
        if (video) {
            video.removeAttribute('poster');
            video.style.backgroundImage = 'none';
            video.style.backgroundColor = '#000';
            video.style.display = 'block';
        }

        // Forzar aislamiento visual en el contenedor del reproductor para evitar superposición
        if (el.detailHero) {
            el.detailHero.style.position = 'relative';
            el.detailHero.style.zIndex = '9999'; // Lo mandamos al frente absoluto por encima de los textos del modal
        }

        if (!this.shaka && video) {
            this.shaka = new shaka.Player(video);
            this.shaka.configure({
                streaming: {
                    lowLatencyMode: true
                }
            });
        }
        
        // Marcamos la clase playing en el contenedor
        el.detailHero.classList.add('playing');
        
        try {
            await this.shaka.load(url);
            video.play();
            
            // Forzar pantalla completa en móviles
            if (video.requestFullscreen) {
                video.requestFullscreen();
            } else if (video.webkitRequestFullscreen) {
                video.webkitRequestFullscreen(); 
            }
        } catch (e) {
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

        // Resetear visualización al abrir la ficha de detalles
        if (el.playerVideo) {
            if (item.thumbUrl) {
                el.playerVideo.setAttribute('poster', item.thumbUrl);
            }
        }
        
        // Devolvemos el contenedor a su orden normal de z-index al abrir detalles sin reproducir
        if (el.detailHero) {
            el.detailHero.style.zIndex = '';
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
        if (el.playerVideo) {
            el.playerVideo.pause(); 
            el.playerVideo.removeAttribute('src');
            el.playerVideo.removeAttribute('poster');
            el.playerVideo.style.backgroundImage = 'none';
        }
        if (el.detailHero) {
            el.detailHero.classList.remove('playing');
            el.detailHero.style.zIndex = ''; // Restaurar capa
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

    // Integración del botón de Telegram Web Personal Admin
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
