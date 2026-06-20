/* ===================================================================
 * Gestor de grupos del administrador.
 *
 * Muestra TODOS los grupos donde la cuenta logueada es miembro,
 * resaltando los que es admin/dueno. Permite entrar en cualquiera
 * y actuar como un cliente Telegram normal:
 *   - leer mensajes
 *   - enviar texto y archivos (videos/imagenes)
 *   - editar texto de cualquier mensaje propio o ajeno (si admin)
 *   - reemplazar el video/archivo de un mensaje
 *   - borrar mensajes
 *   - reenviar a otro grupo
 *
 * Solo accesible si la cuenta logueada es admin del grupo principal
 * (en caso contrario no se muestra el boton).
 * =================================================================== */
(function () {
    'use strict';

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

    function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
    function fmtTime(ts) { try { return new Date(ts * 1000).toLocaleString('es', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); } catch { return ''; } }
    function fmtBytes(n) { if (!n) return ''; const u = ['B', 'KB', 'MB', 'GB']; let v = Number(n), i = 0; while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; } return v.toFixed(v < 10 && i ? 1 : 0) + ' ' + u[i]; }

    async function api(path, opts) {
        const r = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {}, { headers: Object.assign({ 'Content-Type': 'application/json', 'x-auth-token': localStorage.getItem('tvp_token') || '' }, (opts && opts.headers) || {}) }));
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ('Error ' + r.status));
        return data;
    }

    // ===== ESTADO =====
    const state = {
        groups: [],
        groupsLoaded: false,
        currentPeer: '',     // peer seleccionado actualmente
        currentTitle: '',
        currentTopic: 0,
        messages: [],
        thumbs: new Map()    // msgId -> objectURL
    };

    // ===== UI (creada en runtime) =====
    function buildModal() {
        if ($('#tools-modal')) return;
        const html = `
        <div class="modal" id="tools-modal" hidden>
            <div class="modal-overlay" data-tools-close></div>
            <div class="modal-content tools-card">
                <button class="modal-close" data-tools-close aria-label="Cerrar">
                    <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
                <div class="tools-layout">
                    <aside class="tools-sidebar">
                        <header class="tools-side-head">
                            <h3>🗂 Mis grupos</h3>
                            <button id="tools-refresh" class="btn-sm" title="Recargar">↻</button>
                        </header>
                        <input id="tools-filter" class="tools-filter" type="search" placeholder="Buscar grupo...">
                        <div class="tools-tabs">
                            <button class="tools-tab active" data-filter="admin">⭐ Admin</button>
                            <button class="tools-tab" data-filter="all">Todos</button>
                        </div>
                        <div class="tools-list" id="tools-list"></div>
                    </aside>
                    <section class="tools-chat">
                        <header class="tools-chat-head" id="tools-chat-head">
                            <div class="tools-chat-title">Selecciona un grupo</div>
                        </header>
                        <div class="tools-chat-body" id="tools-chat-body">
                            <div class="tools-empty">Elige un grupo para ver y gestionar su contenido.</div>
                        </div>
                        <footer class="tools-compose" id="tools-compose" hidden>
                            <input type="file" id="tools-file" hidden>
                            <button class="btn-sm" id="tools-attach" title="Adjuntar video/archivo">📎</button>
                            <textarea id="tools-text" rows="1" placeholder="Escribe un mensaje..."></textarea>
                            <button class="btn btn-play btn-sm" id="tools-send">Enviar</button>
                        </footer>
                    </section>
                </div>
            </div>
        </div>`;
        const wrap = document.createElement('div'); wrap.innerHTML = html;
        document.body.appendChild(wrap.firstElementChild);
        wireEvents();
    }

    function wireEvents() {
        $$('#tools-modal [data-tools-close]').forEach(el => el.addEventListener('click', close));
        $('#tools-refresh').addEventListener('click', () => loadGroups(true));
        $('#tools-filter').addEventListener('input', renderList);
        $$('#tools-modal .tools-tab').forEach(b => b.addEventListener('click', () => {
            $$('#tools-modal .tools-tab').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            renderList();
        }));
        $('#tools-attach').addEventListener('click', () => $('#tools-file').click());
        $('#tools-file').addEventListener('change', onPickFile);
        $('#tools-send').addEventListener('click', onSendText);
        $('#tools-text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendText(); } });
    }

    async function open() {
        buildModal();
        $('#tools-modal').hidden = false;
        document.body.style.overflow = 'hidden';
        if (!state.groupsLoaded) await loadGroups();
    }
    function close() {
        $('#tools-modal').hidden = true;
        document.body.style.overflow = '';
        // limpiar URLs de thumbs para no fugar memoria
        state.thumbs.forEach(u => URL.revokeObjectURL(u));
        state.thumbs.clear();
    }

    async function loadGroups(force) {
        const list = $('#tools-list');
        list.innerHTML = '<div class="tools-loading">Cargando grupos…</div>';
        try {
            const r = await api('/api/admin/groups');
            state.groups = r.groups || [];
            state.groupsLoaded = true;
            renderList();
        } catch (e) {
            list.innerHTML = `<div class="tools-error">Error: ${esc(e.message)}</div>`;
        }
    }

    function renderList() {
        const list = $('#tools-list');
        const q = ($('#tools-filter').value || '').trim().toLowerCase();
        const onlyAdmin = $('#tools-modal .tools-tab.active').dataset.filter === 'admin';
        const items = state.groups.filter(g => {
            if (onlyAdmin && !g.isAdmin) return false;
            if (q && !g.title.toLowerCase().includes(q) && !(g.username || '').toLowerCase().includes(q)) return false;
            return true;
        });
        if (!items.length) { list.innerHTML = '<div class="tools-empty">No hay grupos.</div>'; return; }
        list.innerHTML = items.map(g => {
            const tag = g.isCreator ? '👑' : g.isAdmin ? '⭐' : '';
            const sub = [
                g.isChannel ? 'Canal' : (g.isMega ? 'Supergrupo' : 'Grupo'),
                g.membersCount ? (g.membersCount + ' miembros') : '',
                g.username ? '@' + g.username : ''
            ].filter(Boolean).join(' · ');
            return `<div class="tools-item${state.currentPeer === g.peerId ? ' active' : ''}" data-peer="${esc(g.peerId)}" data-title="${esc(g.title)}">
                <div class="tools-item-tag">${tag}</div>
                <div class="tools-item-body">
                    <div class="tools-item-title">${esc(g.title)}</div>
                    <div class="tools-item-sub">${esc(sub)}</div>
                </div>
            </div>`;
        }).join('');
        $$('#tools-list .tools-item').forEach(el => el.addEventListener('click', () => selectGroup(el.dataset.peer, el.dataset.title)));
    }

    async function selectGroup(peer, title) {
        state.currentPeer = peer;
        state.currentTitle = title;
        state.currentTopic = 0;
        $('#tools-chat-head').innerHTML = `<div class="tools-chat-title">${esc(title)}</div>
            <div class="tools-chat-actions">
                <button class="btn-sm" id="tools-reload">↻ Recargar</button>
                <span class="tools-peer-id">${esc(peer)}</span>
            </div>`;
        $('#tools-reload').addEventListener('click', () => loadMessages(true));
        $('#tools-compose').hidden = false;
        renderList(); // refrescar el item activo
        await loadMessages(true);
    }

    async function loadMessages(force) {
        const body = $('#tools-chat-body');
        body.innerHTML = '<div class="tools-loading">Cargando mensajes…</div>';
        try {
            const r = await api(`/api/admin/group/${encodeURIComponent(state.currentPeer)}/messages?limit=80`);
            state.messages = r.messages || [];
            renderMessages();
        } catch (e) {
            body.innerHTML = `<div class="tools-error">Error: ${esc(e.message)}</div>`;
        }
    }

    function renderMessages() {
        const body = $('#tools-chat-body');
        if (!state.messages.length) { body.innerHTML = '<div class="tools-empty">Sin mensajes.</div>'; return; }
        // Mostrar de mas antiguo a mas reciente
        const msgs = state.messages.slice().sort((a, b) => a.id - b.id);
        body.innerHTML = msgs.map(m => msgHTML(m)).join('');
        $$('#tools-chat-body .tools-msg').forEach(el => {
            el.querySelector('[data-act="edit"]').addEventListener('click', () => onEdit(Number(el.dataset.id)));
            el.querySelector('[data-act="delete"]').addEventListener('click', () => onDelete(Number(el.dataset.id)));
            const rep = el.querySelector('[data-act="replace"]');
            if (rep) rep.addEventListener('click', () => onReplaceFile(Number(el.dataset.id)));
        });
        body.scrollTop = body.scrollHeight;
        // Cargar miniaturas de mensajes con media
        msgs.filter(m => m.hasMedia && m.hasThumb && !state.thumbs.has(m.id)).forEach(loadThumb);
    }

    function msgHTML(m) {
        const dateStr = fmtTime(m.date) + (m.editedAt ? ' · editado' : '');
        const replaceBtn = (m.isVideo || m.isImage) ? `<button class="msg-act" data-act="replace" title="Reemplazar archivo">🔄</button>` : '';
        const mediaLine = m.hasMedia
            ? `<div class="tools-msg-media">
                  <div class="tools-msg-thumb" id="thumb-${m.id}">${m.isVideo ? '▶' : (m.isImage ? '🖼' : '📎')}</div>
                  <div class="tools-msg-mediainfo">
                    <div>${esc(m.filename || (m.isVideo ? 'Video' : m.isImage ? 'Imagen' : 'Archivo'))}</div>
                    <div class="tools-msg-mediameta">${fmtBytes(m.size)} ${m.duration ? '· ' + esc(m.duration) : ''} ${m.mimeType ? '· ' + esc(m.mimeType) : ''}</div>
                  </div>
              </div>` : '';
        return `<div class="tools-msg" data-id="${m.id}">
            <div class="tools-msg-head">
                <span class="tools-msg-id">#${m.id}</span>
                <span class="tools-msg-date">${esc(dateStr)}</span>
                <div class="tools-msg-actions">
                    <button class="msg-act" data-act="edit" title="Editar texto">✏️</button>
                    ${replaceBtn}
                    <button class="msg-act danger" data-act="delete" title="Borrar">🗑</button>
                </div>
            </div>
            ${mediaLine}
            <div class="tools-msg-text">${esc(m.text || (m.hasMedia ? '' : '(sin texto)'))}</div>
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
        } catch (e) { /* sin miniatura, sin drama */ }
    }

    // ====== ACCIONES ======
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
        // Selector de fichero ad-hoc
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'video/*,image/*';
        inp.onchange = async () => {
            const file = inp.files && inp.files[0]; if (!file) return;
            const m = state.messages.find(x => x.id === msgId);
            const cap = prompt('Texto/leyenda (opcional):', (m && m.text) || '');
            try {
                showStatus('Subiendo archivo... esto puede tardar segun el tamaño.');
                await window.TVP_ADMIN.replaceFile(state.currentPeer, msgId, file, cap || '');
                showStatus('');
                await loadMessages();
            } catch (e) { showStatus(''); alert('Error: ' + e.message); }
        };
        inp.click();
    }
    async function onPickFile(e) {
        const file = e.target.files && e.target.files[0]; if (!file) return;
        e.target.value = '';
        const cap = $('#tools-text').value || '';
        try {
            showStatus('Subiendo ' + file.name + '...');
            await window.TVP_ADMIN.sendFile(state.currentPeer, file, cap);
            $('#tools-text').value = '';
            showStatus('');
            await loadMessages();
        } catch (err) { showStatus(''); alert('Error al enviar: ' + err.message); }
    }
    async function onSendText() {
        const t = $('#tools-text').value.trim(); if (!t) return;
        try {
            await api('/api/admin/send-text', { method: 'POST', body: JSON.stringify({ peer: state.currentPeer, text: t }) });
            $('#tools-text').value = '';
            await loadMessages();
        } catch (e) { alert('No se pudo enviar: ' + e.message); }
    }

    function showStatus(s) {
        let bar = $('#tools-status');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'tools-status';
            bar.className = 'tools-status-bar';
            $('#tools-modal .tools-card').appendChild(bar);
        }
        if (!s) { bar.remove(); return; }
        bar.textContent = s;
    }

    // ====== ENGANCHE: añadir un boton al panel de admin ======
    function attachOpenButton() {
        // Reutilizamos la barra superior: ponemos un boton extra junto al actual
        // boton de panel de admin; solo se muestra si la cuenta es admin.
        const navRight = document.querySelector('.navbar-right');
        if (!navRight || document.getElementById('tools-open')) return;
        const btn = document.createElement('button');
        btn.id = 'tools-open';
        btn.className = 'icon-btn';
        btn.title = 'Gestor de grupos (admin)';
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
        btn.hidden = true;
        btn.addEventListener('click', open);
        navRight.insertBefore(btn, navRight.firstChild);
        // Mostrarlo cuando sepamos que el usuario es admin
        const tryShow = setInterval(() => {
            try { if (window.state && window.state.isAdmin) { btn.hidden = false; clearInterval(tryShow); } } catch { }
        }, 1000);
    }

    document.addEventListener('DOMContentLoaded', attachOpenButton);
})();
