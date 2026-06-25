/* ===================================================================
 * TELEGRAM PERSONAL — Gestor de chats del propietario.
 *
 * Solo accesible para la cuenta marcada como propietaria en tg-config.js.
 * Muestra TODOS los chats (privados, grupos, canales, bots) categorizados
 * al estilo de Telegram, con avatares, y permite gestionar cualquiera de
 * ellos (enviar mensajes, archivos, editar, borrar, reemplazar videos).
 * =================================================================== */
(function () {
    'use strict';

    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

    function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
    function fmtTime(ts) { try { const d = new Date(ts * 1000), now = new Date(); if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
    function fmtBytes(n) { if (!n) return ''; const u = ['B', 'KB', 'MB', 'GB']; let v = Number(n), i = 0; while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; } return v.toFixed(v < 10 && i ? 1 : 0) + ' ' + u[i]; }
    function initials(s) { return String(s || '?').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase(); }
    function colorFor(s) { const palette = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774', '#a3a3a3']; let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return palette[Math.abs(h) % palette.length]; }

    async function api(path, opts) {
        const r = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {}, { headers: Object.assign({ 'Content-Type': 'application/json', 'x-auth-token': localStorage.getItem('tvp_token') || '' }, (opts && opts.headers) || {}) }));
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ('Error ' + r.status));
        return data;
    }

    const CATS = {
        all: { label: 'Todos', icon: '💬' },
        sources: { label: 'Fuentes TV+', icon: '📥' },
        admin: { label: 'Admin', icon: '⭐' },
        private: { label: 'Privados', icon: '👤' },
        groups: { label: 'Grupos', icon: '👥' },
        channels: { label: 'Canales', icon: '📢' },
        bots: { label: 'Bots', icon: '🤖' },
        search: { label: 'Buscar', icon: '🔎' }
    };

    const state = {
        chats: [],
        loaded: false,
        currentPeer: '',
        currentTitle: '',
        currentTopic: 0,
        currentTopicTitle: '',
        topics: [],         // tópicos del grupo actual (si es foro)
        messages: [],
        thumbs: new Map(),
        avatars: new Map(),
        cat: 'all',
        owner: null,
        // === NUEVO: gestion de fuentes y reenvio a TV+ ===
        pinned: new Set(),       // peerIds fijados como "fuentes TV+"
        selecting: false,        // modo seleccion multiple activo en el chat actual
        selected: new Set(),     // msgIds seleccionados en el chat actual
        destTopics: null,        // cache de los temas del grupo principal (cfg.groupId)
        destGroupId: '',         // peerId del grupo principal
        lastDestTopic: {}        // por peer fuente, ultimo tema destino usado
    };

    // ---- Persistencia local de las fuentes fijadas y ultimo destino ----
    function _pinKey() { return 'tvp_pinned_sources_' + ((state.owner && state.owner.userId) || 'anon'); }
    function _destKey() { return 'tvp_lastdest_' + ((state.owner && state.owner.userId) || 'anon'); }
    function loadPinned() {
        try { state.pinned = new Set(JSON.parse(localStorage.getItem(_pinKey()) || '[]')); } catch { state.pinned = new Set(); }
        try { state.lastDestTopic = JSON.parse(localStorage.getItem(_destKey()) || '{}') || {}; } catch { state.lastDestTopic = {}; }
    }
    function savePinned() {
        try { localStorage.setItem(_pinKey(), JSON.stringify(Array.from(state.pinned))); } catch {}
    }
    function saveLastDest() {
        try { localStorage.setItem(_destKey(), JSON.stringify(state.lastDestTopic || {})); } catch {}
    }
    function togglePin(peerId) {
        if (state.pinned.has(peerId)) state.pinned.delete(peerId);
        else state.pinned.add(peerId);
        savePinned();
        updateCatCounts(); renderList();
    }

    function buildModal() {
        if ($('#tg-personal')) return;
        const html = `
        <div class="modal" id="tg-personal" hidden>
            <div class="modal-overlay" data-tg-close></div>
            <div class="modal-content tg-card">
                <button class="modal-close" data-tg-close aria-label="Cerrar">
                    <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
                <div class="tg-banner" id="tg-banner" hidden></div>
                <div class="tg-layout">
                    <aside class="tg-sidebar">
                        <header class="tg-side-head">
                            <h3><span class="tg-brand">Telegram</span><span class="tg-brand-plus">TV+</span></h3>
                            <button id="tg-refresh" class="btn-sm" title="Recargar">↻</button>
                        </header>
                        <input id="tg-search" class="tg-search" type="search" placeholder="🔎 Buscar chats...">
                        <div class="tg-cats" id="tg-cats"></div>
                        <div class="tg-list" id="tg-list"></div>
                    </aside>
                    <section class="tg-main">
                        <header class="tg-main-head" id="tg-main-head">
                            <div class="tg-main-title">Selecciona un chat</div>
                        </header>
                        <div class="tg-main-body" id="tg-main-body">
                            <div class="tg-welcome">
                                <div class="tg-welcome-icon">📨</div>
                                <p class="tg-welcome-hint">Pulsa la <b>⭐ estrella</b> en cualquier chat para fijarlo como <b style="color:#3ee65c">Fuente TV+</b></p>
                            </div>
                        </div>
                        <footer class="tg-compose" id="tg-compose" hidden>
                            <input type="file" id="tg-file" hidden>
                            <button class="btn-sm tg-attach" id="tg-attach" title="Adjuntar">📎</button>
                            <textarea id="tg-text" rows="1" placeholder="Escribe un mensaje..."></textarea>
                            <button class="tg-send-btn" id="tg-send" title="Enviar">
                                <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                            </button>
                        </footer>
                        <div class="tg-status" id="tg-status" hidden></div>
                    </section>
                </div>
            </div>
        </div>`;
        const w = document.createElement('div'); w.innerHTML = html;
        document.body.appendChild(w.firstElementChild);
        renderCats();
        wire();
    }

    function renderCats() {
        const cats = $('#tg-cats');
        cats.innerHTML = Object.entries(CATS).map(([k, v]) => `
            <button class="tg-cat${state.cat === k ? ' active' : ''}" data-cat="${k}">
                <span>${v.icon}</span> <span>${v.label}</span>
                <span class="tg-cat-count" id="tg-cat-${k}"></span>
            </button>`).join('');
        $$('#tg-cats .tg-cat').forEach(b => b.addEventListener('click', () => {
            state.cat = b.dataset.cat;
            renderCats(); renderList();
        }));
    }

    function wire() {
        $$('#tg-personal [data-tg-close]').forEach(el => el.addEventListener('click', close));
        $('#tg-refresh').addEventListener('click', () => loadChats(true));
        $('#tg-search').addEventListener('input', renderList);
        $('#tg-attach').addEventListener('click', () => $('#tg-file').click());
        $('#tg-file').addEventListener('change', onPickFile);
        $('#tg-send').addEventListener('click', onSendText);
        $('#tg-text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendText(); } });
    }

    async function open() {
        buildModal();
        $('#tg-personal').hidden = false;
        document.body.style.overflow = 'hidden';
        if (state.owner && !state.owner.ownerConfigured) showBanner();
        loadPinned();
        if (!state.loaded) await loadChats();
        else { renderList(); updateCatCounts(); }
    }
    function close() {
        $('#tg-personal').hidden = true;
        document.body.style.overflow = '';
        state.thumbs.forEach(u => URL.revokeObjectURL(u)); state.thumbs.clear();
        state.avatars.forEach(u => URL.revokeObjectURL(u)); state.avatars.clear();
    }

    function showBanner() {
        const b = $('#tg-banner');
        if (!b || !state.owner) return;
        b.hidden = false;
        b.innerHTML = `⚠️ <b>Modo configuración</b>: aún no has fijado al propietario.
            Tu ID es <code>${esc(state.owner.userId)}</code>${state.owner.username ? ' · usuario <code>@' + esc(state.owner.username) + '</code>' : ''}.
            Pega ese ID en <code>tg-config.js</code> (campo <code>ownerId</code>) y solo tú podrás abrir este panel.`;
    }

    async function loadChats(force) {
        const list = $('#tg-list');
        list.innerHTML = '<div class="tg-loading">Cargando chats…</div>';
        try {
            const r = await api('/api/admin/groups');
            state.chats = r.groups || [];
            state.loaded = true;
            renderList();
            updateCatCounts();
            // Cargar avatares (en paralelo, sin bloquear)
            state.chats.filter(c => c.hasPhoto).slice(0, 60).forEach(loadAvatar);
        } catch (e) {
            list.innerHTML = `<div class="tg-error">Error: ${esc(e.message)}</div>`;
        }
    }

    function updateCatCounts() {
        const counts = { all: state.chats.length, sources: state.pinned.size, admin: 0, private: 0, groups: 0, channels: 0, bots: 0 };
        for (const c of state.chats) { if (c.isAdmin) counts.admin++; if (counts[c.category] != null) counts[c.category]++; }
        for (const k of Object.keys(counts)) { const el = document.getElementById('tg-cat-' + k); if (el) el.textContent = counts[k] || ''; }
    }

    function renderList() {
        const list = $('#tg-list');
        // Modo "Buscar mensajes": muestra UI de busqueda en lugar de chats
        if (state.cat === 'search') {
            renderSearchUI(); return;
        }
        const q = ($('#tg-search').value || '').trim().toLowerCase();
        const matchQ = (c) => !q || c.title.toLowerCase().includes(q) || (c.username || '').toLowerCase().includes(q);

        // Categoria especial "Fuentes TV+": solo los chats fijados
        if (state.cat === 'sources') {
            const items = state.chats.filter(c => state.pinned.has(c.peerId) && matchQ(c));
            if (!items.length) {
                list.innerHTML = `<div class="tg-empty tg-sources-empty">
                    <div style="font-size:32px;margin-bottom:8px">📥</div>
                    <b>Aún no has fijado ninguna fuente.</b><br>
                    Pulsa la estrella ⭐ junto a cualquier chat (en "Todos", "Grupos" o "Canales") para fijarlo aquí.<br><br>
                    Las fuentes TV+ son los grupos/canales de los que importarás contenido al catálogo.
                </div>`;
                return;
            }
            list.innerHTML = items.map(c => chatItemHTML(c)).join('');
            wireListItems(list);
            return;
        }

        const items = state.chats.filter(c => {
            if (state.cat === 'admin' && !c.isAdmin) return false;
            if (state.cat !== 'all' && state.cat !== 'admin' && c.category !== state.cat) return false;
            return matchQ(c);
        });
        if (!items.length) { list.innerHTML = '<div class="tg-empty">No hay chats en esta categoría.</div>'; return; }

        // Separar fijados al principio (con cabecera) cuando estamos en categorias generales
        const showHeader = (state.cat === 'all' || state.cat === 'groups' || state.cat === 'channels' || state.cat === 'admin');
        const pins = showHeader ? items.filter(c => state.pinned.has(c.peerId)) : [];
        const rest = showHeader ? items.filter(c => !state.pinned.has(c.peerId)) : items;
        let html = '';
        if (pins.length) {
            html += `<div class="tg-list-section">📥 FUENTES TV+ FIJADAS</div>`;
            html += pins.map(c => chatItemHTML(c)).join('');
            html += `<div class="tg-list-section">${state.cat === 'all' ? 'TODOS LOS CHATS' : 'OTROS'}</div>`;
        }
        html += rest.map(c => chatItemHTML(c)).join('');
        list.innerHTML = html;
        wireListItems(list);
    }

    function wireListItems(list) {
        $$('#tg-list .tg-item').forEach(el => el.addEventListener('click', (ev) => {
            // Pulsar la estrella alterna fijado, sin abrir el chat
            if (ev.target && ev.target.closest('[data-pin]')) {
                ev.stopPropagation();
                togglePin(el.dataset.peer);
                return;
            }
            selectChat(el.dataset.peer, el.dataset.title);
        }));
        // Aplicar avatares ya cacheados
        state.avatars.forEach((url, peer) => {
            const av = list.querySelector(`.tg-item[data-peer="${peer}"] .tg-avatar`);
            if (av) { av.style.backgroundImage = `url(${url})`; av.textContent = ''; }
        });
    }

    // ====== BUSQUEDA GLOBAL DE MENSAJES ======
    let _searchTimer = null;
    function renderSearchUI() {
        const list = $('#tg-list');
        list.innerHTML = `
            <div class="tg-search-box">
                <input id="tg-search-q" class="tg-search" type="search" placeholder="Texto a buscar en TUS mensajes..." autocomplete="off">
                <div class="tg-search-filters">
                    <button class="tg-search-tab active" data-kind="all">Todo</button>
                    <button class="tg-search-tab" data-kind="videos">Videos</button>
                    <button class="tg-search-tab" data-kind="photos">Fotos</button>
                    <button class="tg-search-tab" data-kind="docs">Archivos</button>
                    <button class="tg-search-tab" data-kind="links">Enlaces</button>
                </div>
                <div class="tg-search-help">Escribe al menos 2 caracteres. La búsqueda usa la API de Telegram y mira en TODOS tus chats privados, grupos y canales.</div>
                <div class="tg-search-results" id="tg-search-results"></div>
            </div>`;
        const inp = $('#tg-search-q');
        inp.focus();
        inp.addEventListener('input', () => { clearTimeout(_searchTimer); _searchTimer = setTimeout(runGlobalSearch, 350); });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(_searchTimer); runGlobalSearch(); } });
        $$('#tg-list .tg-search-tab').forEach(b => b.addEventListener('click', () => {
            $$('#tg-list .tg-search-tab').forEach(x => x.classList.remove('active'));
            b.classList.add('active'); runGlobalSearch();
        }));
    }
    async function runGlobalSearch() {
        const q = ($('#tg-search-q')?.value || '').trim();
        const kindBtn = document.querySelector('#tg-list .tg-search-tab.active');
        const kind = (kindBtn && kindBtn.dataset.kind) || 'all';
        const out = $('#tg-search-results'); if (!out) return;
        if (q.length < 2) { out.innerHTML = '<div class="tg-empty">Escribe al menos 2 caracteres.</div>'; return; }
        out.innerHTML = '<div class="tg-loading">Buscando…</div>';
        try {
            const r = await api(`/api/admin/search?q=${encodeURIComponent(q)}&kind=${kind}&limit=50`);
            const items = r.results || [];
            if (!items.length) { out.innerHTML = '<div class="tg-empty">Sin resultados.</div>'; return; }
            out.innerHTML = items.map(searchResultHTML).join('');
            $$('#tg-search-results .tg-sr').forEach(el => el.addEventListener('click', () => {
                const peer = el.dataset.peer; const title = el.dataset.title;
                if (peer) selectChat(peer, title);
            }));
        } catch (e) {
            out.innerHTML = `<div class="tg-error">Error: ${esc(e.message)}</div>`;
        }
    }
    function searchResultHTML(m) {
        const date = fmtTime(m.date);
        const tag = m.peerType === 'channel' ? '📢' : m.peerType === 'group' ? '👥' : m.peerType === 'bot' ? '🤖' : '👤';
        const mediaIco = m.isVideo ? '▶ ' : m.isImage ? '🖼 ' : (m.hasMedia ? '📎 ' : '');
        const text = m.text ? m.text.slice(0, 200) : (m.filename ? m.filename : '(media)');
        return `<div class="tg-sr" data-peer="${esc(m.peerId)}" data-title="${esc(m.peerTitle)}">
            <div class="tg-sr-head">
                <span class="tg-sr-icon">${tag}</span>
                <span class="tg-sr-title">${esc(m.peerTitle)}</span>
                <span class="tg-sr-date">${esc(date)}</span>
            </div>
            <div class="tg-sr-text">${esc(mediaIco + text)}</div>
        </div>`;
    }

    function chatItemHTML(c) {
        const tags = [];
        if (c.isCreator) tags.push('<span class="tg-tag premium" title="Dueño">👑</span>');
        else if (c.isAdmin) tags.push('<span class="tg-tag" title="Admin">⭐</span>');
        if (c.verified) tags.push('<span class="tg-tag verified" title="Verificado">✓</span>');
        if (c.premium) tags.push('<span class="tg-tag premium" title="Premium">★</span>');
        if (c.scam) tags.push('<span class="tg-tag scam">SCAM</span>');
        const sub = c.subtitle || (c.username ? '@' + c.username : (
            c.isChannel ? 'Canal' : c.isBot ? 'Bot' : c.isPrivate ? 'Privado' : (c.membersCount ? c.membersCount + ' miembros' : 'Grupo')
        ));
        const unread = c.unread > 0 ? `<span class="tg-unread">${c.unread > 999 ? '999+' : c.unread}</span>` : '';
        const color = colorFor(c.avatarSeed || c.title);
        const avatar = `<div class="tg-avatar" style="background:${color}">${esc(initials(c.title))}</div>`;
        // Boton estrella: solo para grupos y canales (no privados/bots)
        const canPin = c.isGroup || c.isChannel;
        const pinned = state.pinned.has(c.peerId);
        const pinBtn = canPin
            ? `<button class="tg-pin${pinned ? ' active' : ''}" data-pin title="${pinned ? 'Quitar de fuentes TV+' : 'Fijar como fuente TV+'}">${pinned ? '★' : '☆'}</button>`
            : '';
        return `<div class="tg-item${state.currentPeer === c.peerId ? ' active' : ''}${pinned ? ' is-pinned' : ''}" data-peer="${esc(c.peerId)}" data-title="${esc(c.title)}">
            ${avatar}
            <div class="tg-item-body">
                <div class="tg-item-title">${esc(c.title)} ${tags.join('')}${pinned ? '<span class="tg-tag pinsrc" title="Fuente TV+">📥</span>' : ''}</div>
                <div class="tg-item-sub">${esc(sub)}</div>
            </div>
            ${unread}
            ${pinBtn}
        </div>`;
    }

    async function loadAvatar(c) {
        try {
            const blob = await window.TVP_ADMIN.getAvatar(c.peerId);
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            state.avatars.set(c.peerId, url);
            // aplicar en lista
            const av = document.querySelector(`#tg-list .tg-item[data-peer="${c.peerId}"] .tg-avatar`);
            if (av) { av.style.backgroundImage = `url(${url})`; av.textContent = ''; }
            // y en cabecera si es el actual
            if (state.currentPeer === c.peerId) {
                const h = document.querySelector('#tg-main-head .tg-avatar');
                if (h) { h.style.backgroundImage = `url(${url})`; h.textContent = ''; }
            }
        } catch { }
    }

    async function selectChat(peer, title) {
        // Resetear modo seleccion al cambiar de chat
        state.selecting = false;
        state.selected = new Set();
        state.currentPeer = peer;
        state.currentTitle = title;
        state.currentTopic = 0;
        state.currentTopicTitle = '';
        state.topics = [];
        const ch = state.chats.find(x => x.peerId === peer);
        const color = colorFor(title);
        const avurl = state.avatars.get(peer);
        const avhtml = avurl
            ? `<div class="tg-avatar" style="background-image:url(${avurl})"></div>`
            : `<div class="tg-avatar" style="background:${color}">${esc(initials(title))}</div>`;
        const sub = ch ? (ch.username ? '@' + ch.username : (ch.isChannel ? 'Canal' : ch.isBot ? 'Bot' : ch.isPrivate ? 'Privado' : 'Grupo')) : '';
        const canPin = ch && (ch.isGroup || ch.isChannel);
        const isPinned = state.pinned.has(peer);
        const pinHeadBtn = canPin
            ? `<button class="btn-sm tg-head-pin${isPinned ? ' active' : ''}" id="tg-head-pin" title="${isPinned ? 'Quitar de fuentes TV+' : 'Fijar como fuente TV+'}">${isPinned ? '★ Fuente TV+' : '☆ Fijar como fuente'}</button>`
            : '';
        $('#tg-main-head').innerHTML = `${avhtml}
            <div class="tg-main-info">
                <div class="tg-main-title">${esc(title)}</div>
                <div class="tg-main-sub">${esc(sub)} · <code class="tg-peer-id">${esc(peer)}</code></div>
            </div>
            <div class="tg-main-actions">
                ${pinHeadBtn}
                <button class="btn-sm" id="tg-select-toggle" title="Seleccionar varios mensajes">✓ Seleccionar</button>
                <button class="btn-sm" id="tg-reload">↻</button>
            </div>`;
        $('#tg-reload').addEventListener('click', () => loadMessages(true));
        const selBtn = $('#tg-select-toggle');
        if (selBtn) selBtn.addEventListener('click', toggleSelectMode);
        const pinBtn = $('#tg-head-pin');
        if (pinBtn) pinBtn.addEventListener('click', () => { togglePin(peer); selectChat(peer, title); });
        $('#tg-compose').hidden = false;
        renderList();
        if (!avurl && ch && ch.hasPhoto) loadAvatar(ch);
        // Si es foro, cargar topicos primero
        if (ch && ch.isForum) {
            await loadTopics();
        } else {
            $('#tg-topics-bar') && $('#tg-topics-bar').remove();
            await loadMessages(true);
        }
        renderSelectionBar();
    }

    async function loadTopics() {
        try {
            const r = await api(`/api/admin/group/${encodeURIComponent(state.currentPeer)}/topics`);
            state.topics = r.topics || [];
        } catch (e) { state.topics = []; }
        renderTopicsBar();
        // Auto-seleccionar el primero (general)
        const first = state.topics[0];
        if (first) selectTopic(first.id, first.title);
        else loadMessages(true);
    }

    function renderTopicsBar() {
        // Quitar la barra anterior si existe
        const old = document.getElementById('tg-topics-bar'); if (old) old.remove();
        const ch = state.chats.find(x => x.peerId === state.currentPeer);
        if (!ch || !ch.isForum) return;
        const bar = document.createElement('div');
        bar.id = 'tg-topics-bar';
        bar.className = 'tg-topics-bar';

        // Ordenar: el seleccionado primero, despues no leidos, despues por id desc
        const sorted = state.topics.slice().sort((a, b) => {
            if (a.id === state.currentTopic) return -1;
            if (b.id === state.currentTopic) return 1;
            const aU = a.unread > 0 ? 1 : 0, bU = b.unread > 0 ? 1 : 0;
            if (aU !== bU) return bU - aU;
            return Number(b.id) - Number(a.id);
        });

        // Mostrar los primeros N en horizontal (con scroll), y un boton "Todos" si hay mas
        const HEAD_LIMIT = 12;
        const head = sorted.slice(0, HEAD_LIMIT);
        const headHTML = head.map(t => `
            <button class="tg-topic${state.currentTopic === t.id ? ' active' : ''}${t.unread ? ' has-unread' : ''}" data-id="${t.id}" data-title="${esc(t.title)}">
                ${esc(t.title)}${t.unread ? ` <span class="tg-unread">${t.unread > 99 ? '99+' : t.unread}</span>` : ''}
            </button>`).join('');
        const moreBtn = state.topics.length > HEAD_LIMIT
            ? `<button class="tg-topic tg-topic-all" id="tg-topics-all" title="Ver todos los temas">📂 Todos (${state.topics.length}) ▾</button>`
            : `<button class="tg-topic tg-topic-all" id="tg-topics-all" title="Buscar temas" hidden>🔎</button>`;
        const newBtn = ch.isAdmin ? '<button class="tg-topic new" id="tg-topic-new" title="Nuevo tema">+ Nuevo</button>' : '';

        bar.innerHTML = `
            <div class="tg-topics-scroll">${headHTML}</div>
            ${state.topics.length > HEAD_LIMIT ? moreBtn : ''}
            ${newBtn}
        `;
        const headEl = $('#tg-main-head');
        headEl.parentNode.insertBefore(bar, headEl.nextSibling);
        $$('#tg-topics-bar .tg-topic[data-id]').forEach(b => b.addEventListener('click', () => selectTopic(Number(b.dataset.id), b.dataset.title)));
        const newB = document.getElementById('tg-topic-new');
        if (newB) newB.addEventListener('click', onCreateTopic);
        const allB = document.getElementById('tg-topics-all');
        if (allB && !allB.hidden) allB.addEventListener('click', openTopicsDrawer);
    }

    // Panel desplegable con TODOS los temas + busqueda
    function openTopicsDrawer() {
        let drawer = document.getElementById('tg-topics-drawer');
        if (drawer) { drawer.remove(); return; }
        drawer = document.createElement('div');
        drawer.id = 'tg-topics-drawer';
        drawer.className = 'tg-topics-drawer';
        drawer.innerHTML = `
            <div class="tg-topics-drawer-head">
                <input id="tg-topics-q" class="tg-search" type="search" placeholder="🔎 Buscar tema (${state.topics.length} disponibles)..." autofocus>
                <button class="btn-sm" id="tg-topics-close">✕</button>
            </div>
            <div class="tg-topics-drawer-list" id="tg-topics-drawer-list"></div>
        `;
        const bar = document.getElementById('tg-topics-bar');
        bar.parentNode.insertBefore(drawer, bar.nextSibling);
        const q = () => ($('#tg-topics-q').value || '').trim().toLowerCase();
        const renderD = () => {
            const filtered = state.topics.filter(t => !q() || t.title.toLowerCase().includes(q()));
            const list = $('#tg-topics-drawer-list');
            list.innerHTML = filtered.length
                ? filtered.map(t => `
                    <button class="tg-topic-row${state.currentTopic === t.id ? ' active' : ''}" data-id="${t.id}" data-title="${esc(t.title)}">
                        <span class="tg-topic-row-title">${esc(t.title)}</span>
                        ${t.closed ? '<span class="tg-topic-row-tag">cerrado</span>' : ''}
                        ${t.pinned ? '<span class="tg-topic-row-tag pin">📌</span>' : ''}
                        ${t.unread ? `<span class="tg-unread">${t.unread > 99 ? '99+' : t.unread}</span>` : ''}
                    </button>`).join('')
                : '<div class="tg-empty">Sin coincidencias.</div>';
            $$('#tg-topics-drawer-list .tg-topic-row').forEach(b => b.addEventListener('click', () => {
                selectTopic(Number(b.dataset.id), b.dataset.title);
                closeTopicsDrawer();
            }));
        };
        renderD();
        $('#tg-topics-q').addEventListener('input', renderD);
        $('#tg-topics-close').addEventListener('click', closeTopicsDrawer);
    }
    function closeTopicsDrawer() {
        const d = document.getElementById('tg-topics-drawer');
        if (d) d.remove();
    }

    async function onCreateTopic() {
        const title = prompt('Nombre del nuevo tema:');
        if (!title || !title.trim()) return;
        try {
            await api('/api/admin/topic-create', { method: 'POST', body: JSON.stringify({ peer: state.currentPeer, title: title.trim() }) });
            await loadTopics();
        } catch (e) { alert('No se pudo crear el tema: ' + e.message); }
    }

    async function selectTopic(topicId, title) {
        state.currentTopic = topicId;
        state.currentTopicTitle = title;
        state.selecting = false;
        state.selected = new Set();
        closeTopicsDrawer();
        renderTopicsBar();
        await loadMessages(true);
    }

    async function loadMessages(reset) {
        const body = $('#tg-main-body');
        if (reset) body.innerHTML = '<div class="tg-loading">Cargando mensajes…</div>';
        try {
            const tparam = state.currentTopic ? '&topic=' + state.currentTopic : '';
            const r = await api(`/api/admin/group/${encodeURIComponent(state.currentPeer)}/messages?limit=80${tparam}`);
            state.messages = r.messages || [];
            renderMessages();
        } catch (e) {
            body.innerHTML = `<div class="tg-error">Error: ${esc(e.message)}</div>`;
        }
    }

    // Cargar mas mensajes anteriores (los antiguos quedan con id menor)
    async function loadOlderMessages() {
        if (!state.messages.length) return;
        const oldestId = Math.min(...state.messages.map(m => m.id));
        const btn = document.getElementById('tg-load-older');
        if (btn) { btn.disabled = true; btn.textContent = 'Cargando...'; }
        try {
            const tparam = state.currentTopic ? '&topic=' + state.currentTopic : '';
            const r = await api(`/api/admin/group/${encodeURIComponent(state.currentPeer)}/messages?limit=80&offsetId=${oldestId}${tparam}`);
            const more = r.messages || [];
            if (!more.length) {
                if (btn) { btn.textContent = '✓ No hay mas mensajes anteriores'; btn.disabled = true; setTimeout(() => btn.remove(), 1800); }
                return;
            }
            // Conservar la posicion de scroll relativa al primer mensaje visible
            const body = $('#tg-main-body');
            const prevTopMsg = body.querySelector('.tg-msg');
            const prevOffset = prevTopMsg ? prevTopMsg.getBoundingClientRect().top : 0;
            // Anadir SIN reemplazar los existentes
            const existingIds = new Set(state.messages.map(m => m.id));
            for (const m of more) if (!existingIds.has(m.id)) state.messages.push(m);
            renderMessages();
            // Restaurar scroll para que no salte
            requestAnimationFrame(() => {
                const newTopMsg = body.querySelector(`.tg-msg[data-id="${prevTopMsg ? prevTopMsg.dataset.id : ''}"]`);
                if (newTopMsg) {
                    const newOffset = newTopMsg.getBoundingClientRect().top;
                    body.scrollTop += (newOffset - prevOffset);
                }
            });
        } catch (e) {
            if (btn) { btn.textContent = 'Error: ' + e.message; btn.disabled = false; }
        }
    }

    function renderMessages() {
        const body = $('#tg-main-body');
        if (!state.messages.length) { body.innerHTML = '<div class="tg-empty">Sin mensajes recientes.</div>'; return; }
        const msgs = state.messages.slice().sort((a, b) => a.id - b.id);
        // Indice rapido para preview de respuesta
        state._msgIndex = {};
        for (const m of msgs) state._msgIndex[m.id] = m;
        const loadMoreBtn = `<button class="tg-load-more" id="tg-load-older">↑ Cargar mensajes anteriores</button>`;
        body.innerHTML = loadMoreBtn + msgs.map(msgHTML).join('');
        const olderBtn = document.getElementById('tg-load-older');
        if (olderBtn) olderBtn.addEventListener('click', loadOlderMessages);
        $$('#tg-main-body .tg-msg').forEach(el => {
            const id = Number(el.dataset.id);
            // Modo seleccion: el body completo alterna seleccion (excepto botones)
            if (state.selecting) {
                el.addEventListener('click', (ev) => {
                    if (ev.target.closest('.tg-msg-actions') || ev.target.closest('button') || ev.target.closest('a')) return;
                    toggleMessageSelected(id);
                });
            }
            const cb = el.querySelector('.tg-msg-check');
            if (cb) cb.addEventListener('change', () => toggleMessageSelected(id));
            const editBtn = el.querySelector('[data-act="edit"]');
            if (editBtn) editBtn.addEventListener('click', () => onEdit(id));
            const delBtn = el.querySelector('[data-act="delete"]');
            if (delBtn) delBtn.addEventListener('click', () => onDelete(id));
            const rep = el.querySelector('[data-act="replace"]');
            if (rep) rep.addEventListener('click', () => onReplaceFile(id));
            const fwd = el.querySelector('[data-act="forward"]');
            if (fwd) fwd.addEventListener('click', () => onForward(id));
            const sendMine = el.querySelector('[data-act="send-mine"]');
            if (sendMine) sendMine.addEventListener('click', () => openSendToMineDialog([id]));
            const play = el.querySelector('[data-act="play"]');
            if (play) play.addEventListener('click', () => onPlay(id));
            const dl = el.querySelector('[data-act="download"]');
            if (dl) dl.addEventListener('click', () => onDownload(id));
            // Click en la propia tarjeta de media para reproducir/abrir (UX Telegram)
            const card = el.querySelector('.tg-msg-card');
            if (card) card.addEventListener('click', (ev) => {
                if (state.selecting || ev.target.closest('button')) return;
                const m = state._msgIndex[id];
                if (m && (m.isVideo || m.isImage)) onPlay(id);
                else if (m && m.hasMedia) onDownload(id);
            });
            // Click en preview de reply: scroll al mensaje original si esta cargado
            const reply = el.querySelector('.tg-msg-reply');
            if (reply) reply.addEventListener('click', () => {
                const rid = Number(reply.dataset.replyId);
                const target = body.querySelector(`.tg-msg[data-id="${rid}"]`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.add('tg-msg-flash');
                    setTimeout(() => target.classList.remove('tg-msg-flash'), 1500);
                } else {
                    // Si no esta cargado, sugerir cargar mas
                    const oBtn = document.getElementById('tg-load-older');
                    if (oBtn) oBtn.classList.add('attention');
                }
            });
        });
        body.scrollTop = body.scrollHeight;
        msgs.filter(m => m.hasMedia && m.hasThumb && !state.thumbs.has(m.id)).forEach(loadThumb);
        renderSelectionBar();
    }

    function msgHTML(m) {
        const dateStr = fmtTime(m.date) + (m.editedAt ? ' · editado' : '');
        const playBtn = (m.isVideo || m.isImage) ? `<button class="msg-act primary" data-act="play" title="Ver">▶</button>` : '';
        const replaceBtn = (m.isVideo || m.isImage) ? `<button class="msg-act" data-act="replace" title="Reemplazar archivo">🔄</button>` : '';
        const dlBtn = m.hasMedia ? `<button class="msg-act" data-act="download" title="Descargar">⬇</button>` : '';
        const sendMineBtn = `<button class="msg-act tv-plus" data-act="send-mine" title="Enviar a TV+ (mi grupo)">📥</button>`;

        // === Render de la media al estilo Telegram ===
        let mediaHTML = '';
        if (m.hasMedia) {
            if (m.isImage || m.isVideo) {
                // Foto / video: tarjeta grande con thumbnail y overlay de play
                const playOverlay = m.isVideo
                    ? `<div class="tg-msg-play"><svg viewBox="0 0 24 24" width="48" height="48"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.55)"/><path fill="#fff" d="M9 7l8 5-8 5z"/></svg></div>`
                    : '';
                const meta = `${fmtBytes(m.size)}${m.duration ? ' · ' + esc(m.duration) : ''}`;
                mediaHTML = `<div class="tg-msg-card photo${m.isVideo ? ' video' : ''}" id="card-${m.id}">
                    <div class="tg-msg-card-img" id="thumb-${m.id}"></div>
                    ${playOverlay}
                    <div class="tg-msg-card-meta">${esc(meta)}</div>
                </div>`;
            } else {
                // Documento generico: tarjeta tipo "archivo"
                const ext = (m.filename || '').split('.').pop().toUpperCase().slice(0, 5) || 'FILE';
                const title = m.filename || (m.mimeType || 'Archivo');
                mediaHTML = `<div class="tg-msg-card doc" id="card-${m.id}">
                    <div class="tg-msg-card-doc-ico"><span>${esc(ext)}</span></div>
                    <div class="tg-msg-card-doc-info">
                        <div class="tg-msg-card-doc-name">${esc(title)}</div>
                        <div class="tg-msg-card-doc-meta">${fmtBytes(m.size)}${m.duration ? ' · ' + esc(m.duration) : ''}</div>
                    </div>
                </div>`;
            }
        }

        // Preview de respuesta (si responde a otro mensaje)
        let replyHTML = '';
        if (m.replyToMsgId) {
            const rep = state._msgIndex && state._msgIndex[m.replyToMsgId];
            const repText = rep ? (rep.text ? rep.text.slice(0, 80) : (rep.isVideo ? '▶ Video' : rep.isImage ? '🖼 Foto' : rep.filename || '📎 Archivo')) : `Mensaje #${m.replyToMsgId}`;
            replyHTML = `<div class="tg-msg-reply" data-reply-id="${m.replyToMsgId}" title="Ir al mensaje original">
                <div class="tg-msg-reply-bar"></div>
                <div class="tg-msg-reply-body"><span class="tg-msg-reply-label">↩ Respuesta</span> · ${esc(repText)}</div>
            </div>`;
        }

        const isSel = state.selected.has(m.id);
        const checkbox = state.selecting
            ? `<label class="tg-msg-checkbox"><input type="checkbox" class="tg-msg-check" ${isSel ? 'checked' : ''}><span></span></label>`
            : '';
        return `<div class="tg-msg${state.selecting ? ' selecting' : ''}${isSel ? ' selected' : ''}" data-id="${m.id}">
            ${checkbox}
            <div class="tg-msg-inner">
                <div class="tg-msg-head">
                    <span class="tg-msg-id">#${m.id}</span>
                    <span class="tg-msg-date">${esc(dateStr)}</span>
                    <div class="tg-msg-actions">
                        ${playBtn}
                        ${sendMineBtn}
                        <button class="msg-act" data-act="edit" title="Editar">✏️</button>
                        ${replaceBtn}
                        ${dlBtn}
                        <button class="msg-act" data-act="forward" title="Reenviar / copiar a otro chat">↗</button>
                        <button class="msg-act danger" data-act="delete" title="Borrar">🗑</button>
                    </div>
                </div>
                ${replyHTML}
                ${mediaHTML}
                ${m.text ? `<div class="tg-msg-text">${esc(m.text)}</div>` : ''}
            </div>
        </div>`;
    }

    async function loadThumb(m) {
        try {
            const blob = await window.TVP_ADMIN.getThumb(state.currentPeer, m.id);
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            state.thumbs.set(m.id, url);
            const el = document.getElementById('thumb-' + m.id);
            if (el) { el.style.backgroundImage = `url(${url})`; el.textContent = ''; }
        } catch { }
    }

    async function onEdit(msgId) {
        const m = state.messages.find(x => x.id === msgId); if (!m) return;
        const txt = prompt('Editar texto del mensaje:', m.text || '');
        if (txt == null) return;
        try {
            await api('/api/admin/edit-text', { method: 'POST', body: JSON.stringify({ peer: state.currentPeer, msgId, text: txt }) });
            await loadMessages();
        } catch (e) { alert('No se pudo editar: ' + e.message); }
    }
    async function onDelete(msgId) {
        if (!confirm('¿Borrar mensaje #' + msgId + ' para todos?')) return;
        try {
            await api('/api/admin/delete-msgs', { method: 'POST', body: JSON.stringify({ peer: state.currentPeer, msgIds: [msgId] }) });
            await loadMessages();
        } catch (e) { alert('No se pudo borrar: ' + e.message); }
    }
    async function onReplaceFile(msgId) {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'video/*,image/*';
        inp.onchange = async () => {
            const file = inp.files && inp.files[0]; if (!file) return;
            const m = state.messages.find(x => x.id === msgId);
            const cap = prompt('Texto/leyenda (opcional):', (m && m.text) || '');
            try {
                showStatus('Subiendo archivo... esto puede tardar según el tamaño.');
                await window.TVP_ADMIN.replaceFile(state.currentPeer, msgId, file, cap || '');
                showStatus(''); await loadMessages();
            } catch (e) { showStatus(''); alert('Error: ' + e.message); }
        };
        inp.click();
    }
    async function onPickFile(e) {
        const file = e.target.files && e.target.files[0]; if (!file) return;
        e.target.value = '';
        const cap = $('#tg-text').value || '';
        try {
            showStatus('Subiendo ' + file.name + '... 0%');
            // Callback de progreso desde GramJS
            await window.TVP_ADMIN.sendFile(state.currentPeer, file, cap, undefined,
                (sent, total) => {
                    const pct = total ? Math.round(sent / total * 100) : 0;
                    showStatus(`Subiendo ${file.name}: ${pct}% (${fmtBytes(sent)}/${fmtBytes(total)})`);
                }
            );
            $('#tg-text').value = '';
            showStatus(''); await loadMessages();
        } catch (err) { showStatus(''); alert('Error al enviar: ' + err.message); }
    }
    async function onSendText() {
        const t = $('#tg-text').value.trim(); if (!t) return;
        try {
            await api('/api/admin/send-text', { method: 'POST', body: JSON.stringify({ peer: state.currentPeer, text: t }) });
            $('#tg-text').value = '';
            await loadMessages();
        } catch (e) { alert('No se pudo enviar: ' + e.message); }
    }

    // ====== VER VIDEO / DESCARGAR ======
    function buildPlayer() {
        if (document.getElementById('tg-player-overlay')) return;
        const html = `
        <div id="tg-player-overlay" hidden>
            <div class="tg-pl-back"></div>
            <div class="tg-pl-card">
                <button class="tg-pl-close focusable" type="button" tabindex="0" title="Cerrar (o pulsa ATRÁS)">✕</button>
                <video id="tg-pl-video" controls playsinline></video>
                <div class="tg-pl-info" id="tg-pl-info"></div>
            </div>
        </div>`;
        const w = document.createElement('div'); w.innerHTML = html;
        document.body.appendChild(w.firstElementChild);
        $('#tg-player-overlay .tg-pl-back').addEventListener('click', closePlayer);
        $('#tg-player-overlay .tg-pl-close').addEventListener('click', closePlayer);
    }
    function closePlayer() {
        const v = document.getElementById('tg-pl-video');
        if (v) { try { v.pause(); } catch (e) {} v.removeAttribute('src'); v.load(); }
        document.getElementById('tg-player-overlay').hidden = true;
    }
    async function onPlay(msgId) {
        buildPlayer();
        const m = state.messages.find(x => x.id === msgId);
        if (!m) return;
        const u = `tgstreamlink/${encodeURIComponent(state.currentPeer)}/${msgId}`;
        const ext = (m.filename || '').split('.').pop().toLowerCase();
        const browserOk = ['mp4', 'm4v', 'webm', 'ogg', 'ogv', 'mov'].includes(ext);
        $('#tg-player-overlay').hidden = false;
        const v = $('#tg-pl-video');
        v.src = u;
        const dl = u + '?download=1';
        const fname = (m.filename || 'video' + (ext ? '.' + ext : ''));
        const baseLinks = `
            <button id="tg-pl-dl" class="btn-sm" type="button">⬇ Descargar (${fmtBytes(m.size)})</button>
            <button id="tg-pl-mkv" class="btn-sm" type="button">⚡ Reproductor avanzado</button>
            <a class="btn-sm" id="tg-pl-share" href="${esc(dl)}" download="${esc(fname)}" target="_blank">📤 Compartir/abrir</a>
            <a class="btn-sm" id="tg-pl-vlc" href="vlc://${esc(u)}">▶ VLC</a>
            <a class="btn-sm" id="tg-pl-mx" href="intent:${esc(u)}#Intent;type=video/*;action=android.intent.action.VIEW;end">▶ Android (MX/etc.)</a>`;
        $('#tg-pl-info').innerHTML = esc(fname) + ' · ' + fmtBytes(m.size) + '<br>' + baseLinks;
        wirePlayerLinks(msgId, u, dl, m, ext);
        v.onerror = () => {
            $('#tg-pl-info').innerHTML = `<b>Este formato no se reproduce en el navegador.</b> Elige cómo verlo:<br>` + baseLinks;
            wirePlayerLinks(msgId, u, dl, m, ext);
        };
        v.play().catch(() => { });
    }

    function wirePlayerLinks(msgId, u, dl, m, ext) {
        const dlBtn = document.getElementById('tg-pl-dl');
        if (dlBtn) dlBtn.onclick = () => onDownload(msgId);
        const mkvBtn = document.getElementById('tg-pl-mkv');
        if (mkvBtn) mkvBtn.onclick = () => {
            if (window.MkvPlayer) window.MkvPlayer.play({ streamUrl: u, filename: m.filename, ext });
            else alert('Reproductor avanzado no disponible (recarga la página).');
        };
    }
    function onDownload(msgId) {
        const m = state.messages.find(x => x.id === msgId);
        const u = `tgstreamlink/${encodeURIComponent(state.currentPeer)}/${msgId}?download=1`;
        const a = document.createElement('a');
        a.href = u; a.download = (m && m.filename) || 'video';
        a.target = '_blank';
        document.body.appendChild(a); a.click(); a.remove();
    }

    // ====== REENVIAR / COPIAR ======
    function buildForwardDialog() {
        if (document.getElementById('tg-fwd-dialog')) return;
        const html = `
        <div id="tg-fwd-dialog" hidden>
            <div class="tg-fwd-back"></div>
            <div class="tg-fwd-card">
                <button class="tg-fwd-close" type="button">×</button>
                <h3>Reenviar / Copiar a otro chat</h3>
                <input id="tg-fwd-search" class="tg-search" type="search" placeholder="Buscar destino...">
                <div class="tg-fwd-list" id="tg-fwd-list"></div>
                <label class="tg-fwd-opt"><input type="checkbox" id="tg-fwd-copy" checked> <span>Sin mostrar origen ni autor (copia anónima)</span></label>
                <div class="tg-fwd-info" id="tg-fwd-info">Pulsa un chat de la lista para enviar el mensaje seleccionado.</div>
            </div>
        </div>`;
        const wrap = document.createElement('div'); wrap.innerHTML = html;
        document.body.appendChild(wrap.firstElementChild);
        $('#tg-fwd-dialog .tg-fwd-close').addEventListener('click', closeForward);
        $('#tg-fwd-dialog .tg-fwd-back').addEventListener('click', closeForward);
        $('#tg-fwd-search').addEventListener('input', renderFwdList);
    }
    function closeForward() { const d = document.getElementById('tg-fwd-dialog'); if (d) d.hidden = true; }
    function renderFwdList() {
        const list = $('#tg-fwd-list');
        const q = ($('#tg-fwd-search').value || '').trim().toLowerCase();
        const items = state.chats.filter(c => {
            if (c.peerId === state.currentPeer) return false; // no a si mismo
            if (q && !c.title.toLowerCase().includes(q)) return false;
            return true;
        });
        list.innerHTML = items.slice(0, 80).map(c => {
            const av = state.avatars.get(c.peerId);
            const avhtml = av ? `<div class="tg-avatar small" style="background-image:url(${av})"></div>`
                : `<div class="tg-avatar small" style="background:${colorFor(c.title)}">${esc(initials(c.title))}</div>`;
            return `<div class="tg-fwd-item" data-peer="${esc(c.peerId)}" data-title="${esc(c.title)}">
                ${avhtml}
                <div class="tg-fwd-item-body">
                    <div>${esc(c.title)}</div>
                    <div class="tg-fwd-item-sub">${c.isAdmin ? '⭐ ' : ''}${c.isChannel ? 'Canal' : c.isBot ? 'Bot' : c.isPrivate ? 'Privado' : 'Grupo'}</div>
                </div>
            </div>`;
        }).join('');
        $$('#tg-fwd-dialog .tg-fwd-item').forEach(el => el.addEventListener('click', () => doForward(el.dataset.peer, el.dataset.title)));
    }

    let _pendingFwdMsgId = 0;
    async function onForward(msgId) {
        buildForwardDialog();
        _pendingFwdMsgId = msgId;
        $('#tg-fwd-search').value = '';
        $('#tg-fwd-info').textContent = `Vas a reenviar el mensaje #${msgId}. Elige el chat destino:`;
        $('#tg-fwd-dialog').hidden = false;
        renderFwdList();
    }
    async function doForward(toPeer, toTitle) {
        const asCopy = $('#tg-fwd-copy').checked;
        const info = $('#tg-fwd-info');
        const ids = Array.isArray(_pendingFwdMsgId) ? _pendingFwdMsgId : [_pendingFwdMsgId];
        info.textContent = (asCopy ? 'Copiando' : 'Reenviando') + ' ' + ids.length + ' mensaje(s) a "' + toTitle + '"...';
        try {
            await api('/api/admin/forward', {
                method: 'POST',
                body: JSON.stringify({
                    fromPeer: state.currentPeer,
                    msgIds: ids,
                    toPeer, asCopy
                })
            });
            info.textContent = '✅ Enviado a "' + toTitle + '"';
            setTimeout(closeForward, 800);
        } catch (e) {
            info.textContent = '❌ Error: ' + e.message;
        }
    }

    function showStatus(s) {
        const el = $('#tg-status');
        if (!el) return;
        if (!s) { el.hidden = true; el.textContent = ''; return; }
        el.hidden = false; el.textContent = s;
    }

    // ====== SELECCION MULTIPLE Y ENVIO A TV+ ======
    function toggleSelectMode() {
        state.selecting = !state.selecting;
        if (!state.selecting) state.selected = new Set();
        const btn = document.getElementById('tg-select-toggle');
        if (btn) {
            btn.textContent = state.selecting ? '✕ Cancelar' : '✓ Seleccionar';
            btn.classList.toggle('active', state.selecting);
        }
        renderMessages();
    }

    function toggleMessageSelected(msgId) {
        if (state.selected.has(msgId)) state.selected.delete(msgId);
        else state.selected.add(msgId);
        const el = document.querySelector(`.tg-msg[data-id="${msgId}"]`);
        if (el) {
            el.classList.toggle('selected', state.selected.has(msgId));
            const cb = el.querySelector('.tg-msg-check');
            if (cb) cb.checked = state.selected.has(msgId);
        }
        renderSelectionBar();
    }

    function renderSelectionBar() {
        let bar = document.getElementById('tg-sel-bar');
        const main = $('#tg-personal .tg-main');
        if (!main) return;
        const showBar = state.selecting && state.selected.size > 0;
        if (!showBar) { if (bar) bar.remove(); return; }
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'tg-sel-bar';
            bar.className = 'tg-sel-bar';
            main.appendChild(bar);
        }
        const ids = Array.from(state.selected).sort((a, b) => a - b);
        bar.innerHTML = `
            <div class="tg-sel-count"><b>${ids.length}</b> seleccionado${ids.length === 1 ? '' : 's'}</div>
            <button class="btn-sm" id="tg-sel-clear">Cancelar</button>
            <button class="btn-sm primary" id="tg-sel-send">📥 Enviar a TV+</button>
            <button class="btn-sm" id="tg-sel-fwd">↗ Reenviar a otro chat</button>
        `;
        document.getElementById('tg-sel-clear').addEventListener('click', () => { state.selected = new Set(); renderMessages(); });
        document.getElementById('tg-sel-send').addEventListener('click', () => openSendToMineDialog(ids));
        document.getElementById('tg-sel-fwd').addEventListener('click', () => onForwardMany(ids));
    }

    // Reenviar en lote a OTRO chat (reusa el dialogo existente de fwd)
    async function onForwardMany(ids) {
        buildForwardDialog();
        _pendingFwdMsgId = ids; // ahora puede ser array
        $('#tg-fwd-search').value = '';
        $('#tg-fwd-info').textContent = `Vas a reenviar ${ids.length} mensaje(s). Elige el chat destino:`;
        $('#tg-fwd-dialog').hidden = false;
        renderFwdList();
    }

    // ====== DIALOGO: enviar al grupo principal de TV+ con selector de tema ======
    function buildSendMineDialog() {
        if (document.getElementById('tg-mine-dialog')) return;
        const html = `
        <div id="tg-mine-dialog" hidden>
            <div class="tg-mine-back"></div>
            <div class="tg-mine-card">
                <button class="tg-mine-close" type="button">×</button>
                <h3>📥 Enviar a mi grupo TV+</h3>
                <div class="tg-mine-sub" id="tg-mine-sub">Cargando temas del grupo destino…</div>
                <div class="tg-mine-topics" id="tg-mine-topics"></div>
                <label class="tg-mine-opt"><input type="checkbox" id="tg-mine-anon" checked>
                    <span>Modo anónimo (no mostrar de qué grupo viene)</span></label>
                <div class="tg-mine-info" id="tg-mine-info"></div>
            </div>
        </div>`;
        const w = document.createElement('div'); w.innerHTML = html;
        document.body.appendChild(w.firstElementChild);
        $('#tg-mine-dialog .tg-mine-close').addEventListener('click', closeSendMineDialog);
        $('#tg-mine-dialog .tg-mine-back').addEventListener('click', closeSendMineDialog);
    }
    function closeSendMineDialog() {
        const d = document.getElementById('tg-mine-dialog');
        if (d) d.hidden = true;
    }

    let _pendingMineIds = [];
    async function openSendToMineDialog(msgIds) {
        if (!msgIds || !msgIds.length) return;
        _pendingMineIds = msgIds.slice();
        buildSendMineDialog();
        $('#tg-mine-info').textContent = '';
        $('#tg-mine-sub').textContent = `Vas a enviar ${msgIds.length} mensaje(s) desde "${state.currentTitle}". Elige el tema destino:`;
        $('#tg-mine-dialog').hidden = false;
        // Cargar temas (con cache)
        if (!state.destTopics) {
            $('#tg-mine-topics').innerHTML = '<div class="tg-loading">Cargando temas…</div>';
            try {
                const r = await api('/api/admin/dest-topics');
                state.destTopics = r.topics || [];
                state.destGroupId = String(r.groupId || '');
            } catch (e) {
                $('#tg-mine-topics').innerHTML = `<div class="tg-error">Error: ${esc(e.message)}</div>`;
                return;
            }
        }
        renderMineTopics();
    }

    function renderMineTopics() {
        const wrap = $('#tg-mine-topics');
        const last = state.lastDestTopic[state.currentPeer] || 0;
        const topics = state.destTopics || [];
        const items = [{ id: 0, title: 'General (sin tema)' }].concat(topics);
        wrap.innerHTML = items.map(t => {
            const sel = (Number(last) === Number(t.id)) ? ' selected' : '';
            return `<button class="tg-mine-topic${sel}" data-id="${t.id}">${esc(t.title)}</button>`;
        }).join('');
        $$('#tg-mine-topics .tg-mine-topic').forEach(b => b.addEventListener('click', () => doSendToMine(Number(b.dataset.id), b.textContent.trim())));
    }

    async function doSendToMine(topicId, topicTitle) {
        const info = $('#tg-mine-info');
        const anon = !!($('#tg-mine-anon') && $('#tg-mine-anon').checked);
        info.textContent = `Enviando ${_pendingMineIds.length} mensaje(s) a "${topicTitle}"...`;
        $$('#tg-mine-topics .tg-mine-topic').forEach(b => b.disabled = true);
        try {
            await api('/api/admin/forward-to-mine', {
                method: 'POST',
                body: JSON.stringify({
                    fromPeer: state.currentPeer,
                    msgIds: _pendingMineIds,
                    topMsgId: topicId || 0,
                    asCopy: anon
                })
            });
            // Recordar el ultimo tema usado para esta fuente
            state.lastDestTopic[state.currentPeer] = topicId;
            saveLastDest();
            info.innerHTML = `✅ <b>Enviado a TV+</b> (${topicTitle}). El catálogo se refrescará en breve.`;
            // Si veniamos de modo seleccion, limpiar
            if (state.selecting) {
                state.selected = new Set();
                state.selecting = false;
                const btn = document.getElementById('tg-select-toggle');
                if (btn) { btn.textContent = '✓ Seleccionar'; btn.classList.remove('active'); }
                renderMessages();
            }
            setTimeout(closeSendMineDialog, 1100);
        } catch (e) {
            info.innerHTML = `❌ Error: ${esc(e.message)}`;
        } finally {
            $$('#tg-mine-topics .tg-mine-topic').forEach(b => b.disabled = false);
        }
    }

    // ====== ENGANCHE: boton visible para CUALQUIER usuario logueado ======
    // Cada usuario ve SUS propios chats (vienen de su sesion de Telegram).
    async function attach() {
        const navRight = document.querySelector('.navbar-right');
        if (!navRight || document.getElementById('tg-personal-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'tg-personal-btn';
        btn.className = 'icon-btn';
        btn.title = 'Telegram TV+';
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>';
        btn.hidden = true;
        btn.addEventListener('click', open);
        navRight.insertBefore(btn, navRight.firstChild);

        // Solo se muestra al ADMIN/owner y SOLO en la web (no en la APK Android),
        // para que la app pese/cargue menos y los usuarios no accedan.
        const inApk = !!window.NativeHost || /TvPlayer-App/i.test(navigator.userAgent || '');
        if (inApk) return; // en la APK no aparece nunca
        for (let i = 0; i < 30; i++) {
            try {
                const me = await api('/api/me');
                if (me && me.loggedIn) {
                    state.owner = me;
                    loadPinned();
                    if (me.isOwner) btn.hidden = false; // solo el admin/owner lo ve
                    return;
                }
            } catch { }
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    document.addEventListener('DOMContentLoaded', attach);
})();
