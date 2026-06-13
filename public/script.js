/* =====================================================================
 * Tv Player — frontend (consume la API del servidor; sin login, sin bot)
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
async function api(p) { const r = await fetch(p); if (!r.ok) throw new Error('API ' + r.status + ' en ' + p); return r.json(); }

const state = { catalog: { categories: [] }, allItems: [], topics: [], chatCache: {}, activeTopic: null };

const el = {
    body: document.body,
    brand: $('#brand-name'),
    netflixView: $('#netflix-view'),
    telegramView: $('#telegram-view'),
    navbar: $('.navbar'),
    navNetflix: $('#nav-netflix'),
    navTelegram: $('#nav-telegram'),
    navLinks: $('#nav-links'),
    hero: $('#hero'),
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

        if (!cats.length) {
            el.rowsContainer.innerHTML = `<div class="empty-state">No se encontró contenido en los temas configurados.<br>
                Comprueba que el grupo tenga publicaciones en Películas, Series o Deportes.</div>`;
            return;
        }
        let heroPool = [];
        cats.forEach(c => {
            heroPool = heroPool.concat(c.items.slice(0, 5));
            el.rowsContainer.appendChild(this.row(`${c.icon || ''} ${c.name}`, c.items));
        });
        this.updateHero(heroPool[0]);
        if (heroPool.length > 1) {
            let i = 0;
            clearInterval(this._t);
            this._t = setInterval(() => { i = (i + 1) % heroPool.length; this.updateHero(heroPool[i]); }, 10000);
        }
    },

    row(title, items) {
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
        items.forEach(it => track.appendChild(this.card(it)));
        $('.prev', row).onclick = () => track.scrollBy({ left: -800, behavior: 'smooth' });
        $('.next', row).onclick = () => track.scrollBy({ left: 800, behavior: 'smooth' });
        return row;
    },

    card(item) {
        const card = document.createElement('div');
        card.className = 'card';
        const img = item.thumbUrl || placeholderImage(item.id, item.title);
        card.innerHTML = `
            <img class="card-image" src="${img}" alt="${escapeHtml(item.title)}" loading="lazy"
                 onerror="this.src='${placeholderImage(item.id, item.title)}'">
            <div class="card-overlay">
                <h3 class="card-title">${escapeHtml(item.title)}</h3>
                <div class="card-meta">
                    ${item.year ? `<span>${escapeHtml(item.year)}</span>` : ''}
                    ${item.duration ? `<span>${escapeHtml(item.duration)}</span>` : ''}
                    ${item.isVideo ? '<span class="badge-hd">HD</span>' : ''}
                </div>
            </div>
            <div class="card-actions">
                <button class="card-action-btn primary play-btn" title="Reproducir"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></button>
            </div>`;
        $('.play-btn', card).onclick = (e) => { e.stopPropagation(); Player.open(item); };
        card.onclick = () => Player.open(item);
        return card;
    },

    updateHero(item) {
        if (!item) return;
        el.heroImage.src = item.thumbUrl || placeholderImage(item.id, item.title);
        el.heroImage.onerror = () => { el.heroImage.src = placeholderImage(item.id, item.title); };
        el.heroTitle.innerText = item.title;
        el.heroDescription.innerText = item.description || '';
        el.heroBadge.innerText = item.category || '';
        el.heroPlay.onclick = () => Player.open(item);
        el.heroInfo.onclick = () => Player.open(item);
    }
};

/* ===== REPRODUCTOR ===== */
const Player = {
    open(item) {
        el.modalTitle.innerText = item.title;
        el.modalDescription.innerText = item.description || 'Sin descripción.';
        el.modalYear.innerText = item.year || '';
        el.modalDuration.innerText = item.duration || item.size || '';
        el.playerModal.hidden = false;
        el.body.style.overflow = 'hidden';
        el.playerStatus.hidden = true;

        if (item.streamUrl) {
            el.playerIframe.hidden = true; el.playerIframe.src = '';
            el.playerVideo.hidden = false;
            el.playerVideo.src = item.streamUrl;
            el.playerVideo.play().catch(() => {});
            return;
        }
        if (item.externalUrl) {
            el.playerVideo.hidden = true; el.playerVideo.removeAttribute('src'); el.playerVideo.load();
            el.playerIframe.hidden = false;
            el.playerIframe.src = this.embed(item.externalUrl);
            return;
        }
        el.playerVideo.hidden = true; el.playerIframe.hidden = true;
        el.playerStatus.hidden = false;
        el.playerStatus.innerText = 'Esta publicación no tiene video ni enlace reproducible.';
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
    },
    close() {
        el.playerModal.hidden = true;
        el.body.style.overflow = '';
        el.playerIframe.src = '';
        try { el.playerVideo.pause(); } catch {}
        el.playerVideo.removeAttribute('src'); el.playerVideo.load();
    }
};

/* ===== VISTA CHAT (Telegram) ===== */
const Chat = {
    async load() {
        if (state.topics.length) return;
        try { const r = await api('/api/topics'); state.topics = r.topics || []; }
        catch (e) { console.warn(e); }
        this.renderList();
    },
    renderList() {
        const list = state.topics.slice();
        el.chatList.innerHTML = '';
        if (!list.length) {
            el.chatList.innerHTML = '<div class="chat-empty" style="padding:2rem 1rem">No hay temas con la etiqueta configurada.</div>';
            return;
        }
        list.forEach(t => {
            const item = document.createElement('div');
            item.className = 'chat-item is-media';
            item.innerHTML = `
                <div class="chat-avatar">${t.icon || '#'}</div>
                <div class="chat-item-body">
                    <div class="chat-item-top"><span class="chat-item-name">${escapeHtml(t.title)}</span></div>
                    <div class="chat-item-sub">Tema</div>
                </div>`;
            item.onclick = () => this.open(t, item);
            el.chatList.appendChild(item);
        });
    },
    async open(topic, node) {
        state.activeTopic = topic.id;
        $$('.chat-item', el.chatList).forEach(c => c.classList.remove('active'));
        if (node) node.classList.add('active');
        el.chatHeaderTitle.innerText = topic.title;
        el.chatHeaderMeta.innerText = 'cargando...';
        el.chatMessages.innerHTML = '<div class="chat-loading"><div class="loader small"></div></div>';
        let msgs = state.chatCache[topic.id];
        if (!msgs) {
            try { const r = await api('/api/chat/' + topic.id); msgs = r.messages || []; state.chatCache[topic.id] = msgs; }
            catch (e) { el.chatMessages.innerHTML = '<div class="chat-empty">Error: ' + escapeHtml(e.message) + '</div>'; return; }
        }
        el.chatHeaderMeta.innerText = msgs.length + ' mensajes';
        this.renderMessages(msgs);
    },
    renderMessages(msgs) {
        el.chatMessages.innerHTML = '';
        const ordered = msgs.slice().reverse();
        if (!ordered.length) { el.chatMessages.innerHTML = '<div class="chat-empty">No hay mensajes en este tema.</div>'; return; }
        ordered.forEach(m => {
            const b = document.createElement('div');
            b.className = 'tg-message';
            const media = m.hasMedia ? `<div class="tg-media" ${m.thumbUrl ? `style="background-image:url(${m.thumbUrl})"` : ''}><span class="tg-media-icon">${m.isVideo ? '▶' : '🖼'}</span></div>` : '';
            b.innerHTML = `<div class="tg-bubble">${media}${m.text ? `<div class="tg-text">${this.linkify(escapeHtml(m.text))}</div>` : ''}<div class="tg-time">${fmtTime(m.date)}</div></div>`;
            if (m.isVideo) {
                const bub = b.querySelector('.tg-bubble');
                bub.classList.add('playable');
                bub.onclick = () => Player.open({ id: m.id, title: (m.text.split('\n')[0] || 'Video'), description: m.text, streamUrl: m.streamUrl });
            }
            el.chatMessages.appendChild(b);
        });
        el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
    },
    linkify(t) { return t.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
};

/* ===== APP / VISTAS / BÚSQUEDA ===== */
const App = {
    switchView(view) {
        const isNet = view === 'netflix';
        el.netflixView.hidden = !isNet;
        el.telegramView.hidden = isNet;
        el.body.classList.toggle('telegram-mode', !isNet);
        el.navNetflix.classList.toggle('active', isNet);
        el.navTelegram.classList.toggle('active', !isNet);
        if (!isNet) {
            Chat.load().then(() => {
                if (!state.activeTopic) {
                    const mediaIds = new Set(state.catalog.categories.map(c => c.id));
                    const first = state.topics.find(t => !mediaIds.has(t.id)) || state.topics[0];
                    const node = $$('.chat-item', el.chatList).find(n => n.querySelector('.chat-item-name').innerText === (first && first.title));
                    if (first) Chat.open(first, node);
                }
            });
        }
    },
    search(q) {
        q = q.trim().toLowerCase();
        if (!q) { el.searchResults.innerHTML = ''; return; }
        const res = state.allItems.filter(it =>
            it.title.toLowerCase().includes(q) ||
            (it.description || '').toLowerCase().includes(q) ||
            (it.category || '').toLowerCase().includes(q));
        if (!res.length) { el.searchResults.innerHTML = '<div class="search-empty">Sin resultados.</div>'; return; }
        el.searchResults.innerHTML = '';
        res.forEach(it => {
            const c = document.createElement('div');
            c.className = 'search-card';
            c.innerHTML = `<img class="search-image" src="${it.thumbUrl || placeholderImage(it.id, it.title)}" alt=""
                onerror="this.src='${placeholderImage(it.id, it.title)}'">
                <div class="search-meta"><h3>${escapeHtml(it.title)}</h3>
                <p>${escapeHtml((it.description || '').slice(0, 140))}</p>
                <span class="search-cat">${escapeHtml(it.category || '')}</span></div>`;
            c.onclick = () => { this.closeSearch(); Player.open(it); };
            el.searchResults.appendChild(c);
        });
    },
    openSearch() { el.searchOverlay.hidden = false; el.searchInput.focus(); el.body.style.overflow = 'hidden'; },
    closeSearch() { el.searchOverlay.hidden = true; el.searchInput.value = ''; el.searchResults.innerHTML = ''; el.body.style.overflow = ''; }
};

/* ===== ARRANQUE ===== */
async function boot() {
    try {
        const info = await api('/api/app').catch(() => null);
        if (info && info.appName) { el.brand.innerText = info.appName.toUpperCase(); document.title = info.appName; }

        el.loadingText.innerText = 'Cargando catálogo...';
        const catalog = await api('/api/catalog');
        state.catalog = catalog;
        // anexar categoría a cada item para búsqueda/hero
        catalog.categories.forEach(c => c.items.forEach(it => { it.category = c.name; state.allItems.push(it); }));
        Netflix.render();
        App.switchView('netflix');
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
    $('.modal-close', el.playerModal).onclick = () => Player.close();
    $('.modal-overlay', el.playerModal).onclick = () => Player.close();
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
        else if (!el.playerModal.hidden) Player.close();
    });
    window.addEventListener('scroll', () => {
        el.navbar.classList.toggle('scrolled', window.scrollY > 50);
    });
}

document.addEventListener('DOMContentLoaded', () => { wireUi(); boot(); });
