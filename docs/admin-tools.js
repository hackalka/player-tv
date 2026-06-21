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
        owner: null
    };

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
                            <h3>📨 Mi Telegram</h3>
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
                                <h2>Tu Telegram personal</h2>
                                <p>Elige un chat de la izquierda para verlo y gestionarlo.</p>
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
        if (!state.loaded) await loadChats();
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
        const counts = { all: state.chats.length, admin: 0, private: 0, groups: 0, channels: 0, bots: 0 };
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
        const items = state.chats.filter(c => {
            if (state.cat === 'admin' && !c.isAdmin) return false;
            if (state.cat !== 'all' && state.cat !== 'admin' && c.category !== state.cat) return false;
            if (q && !c.title.toLowerCase().includes(q) && !(c.username || '').toLowerCase().includes(q)) return false;
            return true;
        });
        if (!items.length) { list.innerHTML = '<div class="tg-empty">No hay chats en esta categoría.</div>'; return; }
        list.innerHTML = items.map(c => chatItemHTML(c)).join('');
        $$('#tg-list .tg-item').forEach(el => el.addEventListener('click', () => selectChat(el.dataset.peer, el.dataset.title)));
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
        return `<div class="tg-item${state.currentPeer === c.peerId ? ' active' : ''}" data-peer="${esc(c.peerId)}" data-title="${esc(c.title)}">
            ${avatar}
            <div class="tg-item-body">
                <div class="tg-item-title">${esc(c.title)} ${tags.join('')}</div>
                <div class="tg-item-sub">${esc(sub)}</div>
            </div>
            ${unread}
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
        $('#tg-main-head').innerHTML = `${avhtml}
            <div class="tg-main-info">
                <div class="tg-main-title">${esc(title)}</div>
                <div class="tg-main-sub">${esc(sub)} · <code class="tg-peer-id">${esc(peer)}</code></div>
            </div>
            <div class="tg-main-actions">
                <button class="btn-sm" id="tg-reload">↻</button>
            </div>`;
        $('#tg-reload').addEventListener('click', () => loadMessages(true));
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
        const items = state.topics.map(t => `
            <button class="tg-topic${state.currentTopic === t.id ? ' active' : ''}" data-id="${t.id}" data-title="${esc(t.title)}">
                ${esc(t.title)}${t.unread ? ` <span class="tg-unread">${t.unread > 99 ? '99+' : t.unread}</span>` : ''}
            </button>`).join('');
        bar.innerHTML = items + (ch.isAdmin ? '<button class="tg-topic new" id="tg-topic-new" title="Nuevo tema">+ Nuevo</button>' : '');
        const head = $('#tg-main-head');
        head.parentNode.insertBefore(bar, head.nextSibling);
        $$('#tg-topics-bar .tg-topic[data-id]').forEach(b => b.addEventListener('click', () => selectTopic(Number(b.dataset.id), b.dataset.title)));
        const newBtn = document.getElementById('tg-topic-new');
        if (newBtn) newBtn.addEventListener('click', onCreateTopic);
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
        renderTopicsBar();
        await loadMessages(true);
    }

    async function loadMessages() {
        const body = $('#tg-main-body');
        body.innerHTML = '<div class="tg-loading">Cargando mensajes…</div>';
        try {
            const tparam = state.currentTopic ? '&topic=' + state.currentTopic : '';
            const r = await api(`/api/admin/group/${encodeURIComponent(state.currentPeer)}/messages?limit=80${tparam}`);
            state.messages = r.messages || [];
            renderMessages();
        } catch (e) {
            body.innerHTML = `<div class="tg-error">Error: ${esc(e.message)}</div>`;
        }
    }

    function renderMessages() {
        const body = $('#tg-main-body');
        if (!state.messages.length) { body.innerHTML = '<div class="tg-empty">Sin mensajes recientes.</div>'; return; }
        const msgs = state.messages.slice().sort((a, b) => a.id - b.id);
        body.innerHTML = msgs.map(msgHTML).join('');
        $$('#tg-main-body .tg-msg').forEach(el => {
            el.querySelector('[data-act="edit"]').addEventListener('click', () => onEdit(Number(el.dataset.id)));
            el.querySelector('[data-act="delete"]').addEventListener('click', () => onDelete(Number(el.dataset.id)));
            const rep = el.querySelector('[data-act="replace"]');
            if (rep) rep.addEventListener('click', () => onReplaceFile(Number(el.dataset.id)));
            const fwd = el.querySelector('[data-act="forward"]');
            if (fwd) fwd.addEventListener('click', () => onForward(Number(el.dataset.id)));
            const play = el.querySelector('[data-act="play"]');
            if (play) play.addEventListener('click', () => onPlay(Number(el.dataset.id)));
            const dl = el.querySelector('[data-act="download"]');
            if (dl) dl.addEventListener('click', () => onDownload(Number(el.dataset.id)));
        });
        body.scrollTop = body.scrollHeight;
        msgs.filter(m => m.hasMedia && m.hasThumb && !state.thumbs.has(m.id)).forEach(loadThumb);
    }

    function msgHTML(m) {
        const dateStr = fmtTime(m.date) + (m.editedAt ? ' · editado' : '');
        const playBtn = (m.isVideo || m.isImage) ? `<button class="msg-act primary" data-act="play" title="Ver">▶</button>` : '';
        const replaceBtn = (m.isVideo || m.isImage) ? `<button class="msg-act" data-act="replace" title="Reemplazar archivo">🔄</button>` : '';
        const dlBtn = m.hasMedia ? `<button class="msg-act" data-act="download" title="Descargar">⬇</button>` : '';
        const mediaIcon = m.isVideo ? '▶' : m.isImage ? '🖼' : '📎';
        const mediaTitle = m.filename || (m.isVideo ? 'Video' : m.isImage ? 'Imagen' : 'Archivo');
        const mediaLine = m.hasMedia ? `<div class="tg-msg-media">
            <div class="tg-msg-thumb" id="thumb-${m.id}">${mediaIcon}</div>
            <div class="tg-msg-mediainfo">
                <div>${esc(mediaTitle)}</div>
                <div class="tg-msg-mediameta">${fmtBytes(m.size)} ${m.duration ? '· ' + esc(m.duration) : ''}</div>
            </div>
        </div>` : '';
        return `<div class="tg-msg" data-id="${m.id}">
            <div class="tg-msg-head">
                <span class="tg-msg-id">#${m.id}</span>
                <span class="tg-msg-date">${esc(dateStr)}</span>
                <div class="tg-msg-actions">
                    ${playBtn}
                    <button class="msg-act" data-act="edit" title="Editar">✏️</button>
                    ${replaceBtn}
                    ${dlBtn}
                    <button class="msg-act" data-act="forward" title="Reenviar / copiar a otro chat">↗</button>
                    <button class="msg-act danger" data-act="delete" title="Borrar">🗑</button>
                </div>
            </div>
            ${mediaLine}
            ${m.text ? `<div class="tg-msg-text">${esc(m.text)}</div>` : ''}
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
                <button class="tg-pl-close" type="button">×</button>
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
        // streamUrl que sirve el SW: tgstreamlink/<peer>/<msgId>
        const u = `tgstreamlink/${encodeURIComponent(state.currentPeer)}/${msgId}`;
        const ext = (m.filename || '').split('.').pop().toLowerCase();
        const browserOk = ['mp4', 'm4v', 'webm', 'ogg', 'ogv', 'mov'].includes(ext);
        $('#tg-player-overlay').hidden = false;
        const v = $('#tg-pl-video');
        v.src = u;
        $('#tg-pl-info').textContent = (m.filename || '') + ' · ' + fmtBytes(m.size);
        v.onerror = () => {
            $('#tg-pl-info').innerHTML = `Este formato no se reproduce en el navegador.
                <button id="tg-pl-dl" class="btn-sm" type="button">⬇ Descargar</button>
                <button id="tg-pl-mkv" class="btn-sm" type="button">⚡ Reproducir avanzado (FFmpeg)</button>`;
            $('#tg-pl-dl').addEventListener('click', () => onDownload(msgId));
            $('#tg-pl-mkv').addEventListener('click', () => {
                if (window.MkvPlayer) window.MkvPlayer.play({ streamUrl: u, filename: m.filename, ext });
            });
        };
        v.play().catch(() => {});
    }
    function onDownload(msgId) {
        const m = state.messages.find(x => x.id === msgId);
        const u = `tgstreamlink/${encodeURIComponent(state.currentPeer)}/${msgId}?download=1`;
        const a = document.createElement('a');
        a.href = u; a.download = (m && m.filename) || 'video';
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
        info.textContent = (asCopy ? 'Copiando' : 'Reenviando') + ' a "' + toTitle + '"...';
        try {
            await api('/api/admin/forward', {
                method: 'POST',
                body: JSON.stringify({
                    fromPeer: state.currentPeer,
                    msgIds: [_pendingFwdMsgId],
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

    // ====== ENGANCHE: boton visible para CUALQUIER usuario logueado ======
    // Cada usuario ve SUS propios chats (vienen de su sesion de Telegram).
    async function attach() {
        const navRight = document.querySelector('.navbar-right');
        if (!navRight || document.getElementById('tg-personal-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'tg-personal-btn';
        btn.className = 'icon-btn';
        btn.title = 'Mi Telegram personal';
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>';
        btn.hidden = true;
        btn.addEventListener('click', open);
        navRight.insertBefore(btn, navRight.firstChild);

        // Lo mostramos a CUALQUIERA que este logueado en Telegram. El owner
        // sigue siendo solo TU para los botones admin del catalogo (carátula, enlace).
        for (let i = 0; i < 30; i++) {
            try {
                const me = await api('/api/me');
                if (me && me.loggedIn) {
                    state.owner = me;
                    btn.hidden = false;
                    return;
                }
            } catch { }
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    document.addEventListener('DOMContentLoaded', attach);
})();
