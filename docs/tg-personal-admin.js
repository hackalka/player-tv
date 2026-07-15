/* ===================================================================
 * TELEGRAM PERSONAL PRO (ADMIN MAX EDITION) 
 * =================================================================== */
(function () {
    'use strict';

    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

    function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
    
    function fmtTime(ts) { 
        try { 
            const d = new Date(ts * 1000), now = new Date(); 
            if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); 
            return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' }); 
        } catch { 
            return ''; 
        } 
    }
    
    function initials(s) { return String(s || '?').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase(); }
    
    function colorFor(s) { 
        const palette = ['#2471a3', '#2e4053', '#229954', '#d35400', '#884ea4', '#117a65']; 
        let h = 0; 
        for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; 
        return palette[Math.abs(h) % palette.length]; 
    }

    async function api(path, opts) {
        const r = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {}, { 
            headers: Object.assign({ 
                'Content-Type': 'application/json', 
                'x-auth-token': localStorage.getItem('tvp_token') || '' 
            }, (opts && opts.headers) || {}) 
        }));
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
        channels: { label: 'Canales', icon: '📢' }
    };

    const state = {
        chats: [],
        loaded: false,
        currentPeer: '',
        currentTitle: '',
        currentChatObj: null,
        messages: [],
        cat: 'all',
        pinned: new Set(),
        // Forzamos que por defecto use el tema acestream si no hay ninguno guardado
        theme: localStorage.getItem('tg_pref_theme') || 'acestream',
        forwardCache: null
    };

    const PREMIUM_EMOJIS = {
        '⚡': 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/26a1.png',
        '🔥': 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f525.png',
        '👑': 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f451.png',
        '💎': 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f48e.png',
        '🚀': 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f680.png'
    };

    function injectStyles() {
        if ($('#tg-web-styles')) return;
        const style = document.createElement('style');
        style.id = 'tg-web-styles';
        style.textContent = `
            #tg-personal { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 99999; display: flex; align-items: center; justify-content: center; }
            #tg-personal .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.6); z-index: 99998; }
            #tg-personal .modal-content { background: var(--tg-bg); color: var(--tg-text); border-radius: 12px; width: 95vw; height: 90vh; max-width: 1400px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.5); border: 1px solid var(--tg-border); position: relative; z-index: 99999; }
            #tg-personal .tg-layout { display: flex; flex: 1; overflow: hidden; height: 100%; }
            
            .theme-telegram { --tg-bg: #fff; --tg-text: #333; --tg-border: #dfe5ec; --tg-sidebar-bg: #ffffff; --tg-chat-bg: #f4f4f5; --tg-active: #3390ec; --tg-active-text: #fff; --tg-bubble-in: #f1f1f4; --tg-bubble-out: #eeffde; --tg-bubble-text: #000; }
            .theme-dark { --tg-bg: #181818; --tg-text: #e0e0e0; --tg-border: #2c2c2c; --tg-sidebar-bg: #1e1e1e; --tg-chat-bg: #0f0f0f; --tg-active: #2f6ea7; --tg-active-text: #fff; --tg-bubble-in: #262626; --tg-bubble-out: #2b5278; --tg-bubble-text: #fff; }
            .theme-acestream { --tg-bg: #121214; --tg-text: #e4e4e7; --tg-border: #27272a; --tg-sidebar-bg: #18181b; --tg-chat-bg: #09090b; --tg-active: #ff6000; --tg-active-text: #fff; --tg-bubble-in: #1c1c21; --tg-bubble-out: #3d2213; --tg-bubble-text: #fff; }

            .tg-sidebar { width: 340px; background: var(--tg-sidebar-bg); border-right: 1px solid var(--tg-border); display: flex; flex-direction: column; }
            .tg-main { flex: 1; display: flex; flex-direction: column; background: var(--tg-chat-bg); position: relative; }
            
            .tg-search-wrap { padding: 10px 12px; }
            .tg-search { width: 100%; width: -webkit-fill-available; padding: 8px 12px; border: 1px solid var(--tg-border); border-radius: 8px; background: var(--tg-bg); color: var(--tg-text); outline: none; }
            
            .tg-cats { display: flex; gap: 4px; overflow-x: auto; padding: 4px 12px; border-bottom: 1px solid var(--tg-border); }
            .tg-cat { border: none; background: transparent; color: var(--tg-text); opacity: 0.7; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; white-space: nowrap; }
            .tg-cat.active { opacity: 1; background: var(--tg-active); color: var(--tg-active-text) !important; font-weight: 600; }
            
            .tg-list { flex: 1; overflow-y: auto; }
            .tg-item { display: flex; align-items: center; padding: 10px 14px; cursor: pointer; gap: 12px; border-bottom: 1px solid var(--tg-border); }
            .tg-item.active { background: var(--tg-active) !important; color: var(--tg-active-text) !important; }
            
            .tg-avatar { width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; color: white; flex-shrink: 0; }
            .tg-item-body { flex: 1; min-width: 0; }
            .tg-item-title { font-weight: 600; font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .tg-item-sub { font-size: 0.8rem; opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            
            .tg-main-body { flex: 1; overflow-y: auto; padding: 16px 24px; display: flex; flex-direction: column; gap: 8px; }
            .tg-msg { max-width: 65%; padding: 8px 12px; border-radius: 12px; background: var(--tg-bubble-in); color: var(--tg-bubble-text); align-self: flex-start; box-shadow: 0 1px 2px rgba(0,0,0,0.1); position: relative; word-break: break-word; }
            .tg-msg.my-msg { align-self: flex-end; background: var(--tg-bubble-out); }
            
            .tg-msg-actions { position: absolute; top: -12px; right: 10px; background: var(--tg-sidebar-bg); border: 1px solid var(--tg-border); border-radius: 6px; display: none; gap: 4px; padding: 2px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 10; }
            .tg-msg:hover .tg-msg-actions { display: flex; }
            .tg-msg-btn { background: transparent; border: none; color: var(--tg-text); cursor: pointer; font-size: 0.75rem; padding: 2px 6px; }

            .tg-edit-panel { width: 320px; background: var(--tg-sidebar-bg); border-left: 1px solid var(--tg-border); display: flex; flex-direction: column; padding: 16px; gap: 14px; overflow-y: auto; }
            .tg-input-group { display: flex; flex-direction: column; gap: 6px; }
            .tg-input-group label { font-size: 0.8rem; font-weight: 600; opacity: 0.8; }
            .tg-input-group input, .tg-input-group textarea { padding: 8px 12px; background: var(--tg-chat-bg); border: 1px solid var(--tg-border); color: var(--tg-text); border-radius: 6px; outline: none; font-size: 0.9rem; }
            
            .tg-premium-emoji { width: 32px; height: 32px; display: inline-block; vertical-align: middle; }
            .tg-compose { padding: 14px 20px; background: var(--tg-sidebar-bg); border-top: 1px solid var(--tg-border); display: flex; align-items: center; gap: 12px; }
            .tg-compose textarea { flex: 1; background: var(--tg-chat-bg); border: 1px solid var(--tg-border); color: var(--tg-text); border-radius: 18px; padding: 10px 16px; resize: none; outline: none; }
            .tg-forward-banner { background: var(--tg-active); color: #fff; padding: 8px 16px; display: flex; justify-content: space-between; align-items: center; }
            .tg-theme-selector { background: var(--tg-chat-bg); color: var(--tg-text); border: 1px solid var(--tg-border); border-radius: 4px; padding: 4px 8px; outline: none; font-size: 0.85rem; }
        `;
        document.head.appendChild(style);
    }

    function buildModal() {
        if (!document.body) {
            // Protección por si el body no existe aún al intentar construir
            setTimeout(buildModal, 50);
            return;
        }
        if ($('#tg-personal')) return;
        injectStyles();
        
        const html = `
        <div class="modal" id="tg-personal" hidden>
            <div class="modal-overlay" data-tg-close></div>
            <div class="modal-content tg-card theme-${state.theme}">
                <div id="tg-forward-alert" class="tg-forward-banner" hidden>
                    <span id="tg-forward-desc"></span>
                    <button id="tg-forward-cancel" style="background:transparent; border:none; color:#fff; cursor:pointer;">✕ Cancelar</button>
                </div>
                <div class="tg-layout">
                    <aside class="tg-sidebar">
                        <header class="tg-side-head" style="padding:12px 16px; display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--tg-border);">
                            <strong style="font-size:1.1rem;">Telegram Web Admin</strong>
                            <select class="tg-theme-selector" id="tg-theme-select">
                                <option value="acestream">Tema AceStream</option>
                                <option value="dark">Modo Oscuro</option>
                                <option value="telegram">Telegram Blue</option>
                            </select>
                        </header>
                        <div class="tg-search-wrap"><input id="tg-search" class="tg-search" type="search" placeholder="Buscar canales o grupos..."></div>
                        <div class="tg-cats" id="tg-cats"></div>
                        <div class="tg-list" id="tg-list"></div>
                    </aside>
                    <section class="tg-main">
                        <header class="tg-main-head" id="tg-main-head">
                            <div style="padding:18px; font-weight:600; opacity:0.7; text-align: center;">Selecciona una comunidad para gestionar</div>
                        </header>
                        <div style="display:flex; flex:1; overflow:hidden;">
                            <div style="display:flex; flex-direction:column; flex:1; height:100%;">
                                <div class="tg-main-body" id="tg-main-body"></div>
                                <footer class="tg-compose" id="tg-compose" hidden>
                                    <textarea id="tg-text" rows="1" placeholder="Escribe al grupo..."></textarea>
                                    <button id="tg-send" style="background:transparent; border:none; color:var(--tg-active); font-weight:bold; cursor:pointer; font-size:1rem; padding: 0 8px;">Enviar</button>
                                </footer>
                            </div>
                            <div class="tg-edit-panel" id="tg-edit-panel" hidden></div>
                        </div>
                    </section>
                </div>
            </div>
        </div>`;
        
        const w = document.createElement('div'); 
        w.innerHTML = html;
        document.body.appendChild(w.firstElementChild);
        
        $('#tg-theme-select').value = state.theme;
        $('#tg-theme-select').addEventListener('change', (e) => changeTheme(e.target.value));
        $('#tg-forward-cancel').addEventListener('click', () => { state.forwardCache = null; $('#tg-forward-alert').hidden = true; });
        
        renderCats();
        wire();
    }

    function changeTheme(themeKey) {
        state.theme = themeKey;
        localStorage.setItem('tg_pref_theme', themeKey);
        const content = $('#tg-personal .modal-content');
        if (content) {
            content.className = `modal-content tg-card theme-${themeKey}`;
        }
    }

    function renderCats() {
        const catsEl = $('#tg-cats');
        if (!catsEl) return;
        catsEl.innerHTML = Object.entries(CATS).map(([k, v]) => `
            <button class="tg-cat${state.cat === k ? ' active' : ''}" data-cat="${k}">${v.icon} ${v.label}</button>`).join('');
        $$('#tg-cats .tg-cat').forEach(b => b.addEventListener('click', () => { state.cat = b.dataset.cat; renderCats(); renderList(); }));
    }

    function wire() {
        $$('#tg-personal [data-tg-close]').forEach(el => el.addEventListener('click', () => $('#tg-personal').hidden = true));
        $('#tg-search').addEventListener('input', renderList);
        $('#tg-send').addEventListener('click', onSendText);
        $('#tg-text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendText(); } });
    }

    async function open() { 
        buildModal(); 
        const modal = $('#tg-personal');
        if (modal) {
            modal.hidden = false; 
        }
        await loadChats(); 
    }

    async function loadChats() { 
        try { 
            const r = await api('/api/admin/groups'); 
            state.chats = r.groups || []; 
            renderList(); 
        } catch(e) {
            console.error("No se pudieron cargar los chats del backend:", e);
        } 
    }

    function renderList() {
        const q = ($('#tg-search').value || '').toLowerCase();
        const items = state.chats.filter(c => {
            if (state.cat === 'sources' && !state.pinned.has(c.peerId)) return false;
            if (state.cat === 'admin' && !c.isAdmin) return false;
            if (state.cat !== 'all' && state.cat !== 'sources' && state.cat !== 'admin' && c.category !== state.cat) return false;
            return !q || c.title.toLowerCase().includes(q);
        });
        const listEl = $('#tg-list');
        if (!listEl) return;
        listEl.innerHTML = items.map(c => `
            <div class="tg-item${state.currentPeer === c.peerId ? ' active' : ''}" data-peer="${c.peerId}" data-title="${c.title}">
                <div class="tg-avatar" style="background:${colorFor(c.title)}">${initials(c.title)}</div>
                <div class="tg-item-body">
                    <div class="tg-item-title">${esc(c.title)}</div>
                    <div class="tg-item-sub">${esc(c.username ? '@' + c.username : 'ID: ' + c.peerId.slice(0,8))}</div>
                </div>
            </div>`).join('');
        $$('.tg-item', listEl).forEach(el => el.addEventListener('click', () => selectChat(el.dataset.peer, el.dataset.title)));
    }

    async function selectChat(peer, title) {
        state.currentPeer = peer; 
        state.currentTitle = title;
        state.currentChatObj = state.chats.find(c => c.peerId === peer) || { title, username: '', description: '' };
        
        $('#tg-compose').hidden = false;
        $('#tg-edit-panel').hidden = true; 

        if (state.forwardCache) { 
            await executeCleanForward(peer); 
            return; 
        }

        $('#tg-main-head').innerHTML = `
            <div style="padding:14px 20px; border-bottom:1px solid var(--tg-border); background: var(--tg-sidebar-bg); display:flex; justify-content:space-between; align-items:center;">
                <div><strong>${esc(title)}</strong><br><small style="font-size:0.75rem; opacity:0.6;">${esc(peer)}</small></div>
                <button id="tg-open-edit" style="background:var(--tg-active); border:none; color:white; padding:6px 12px; border-radius:6px; cursor:pointer; font-weight:600;">⚙️ Ajustes</button>
            </div>`;
            
        $('#tg-open-edit').addEventListener('click', toggleEditPanel);
        
        renderList();
        await loadMessages();
    }

    function toggleEditPanel() {
        const panel = $('#tg-edit-panel');
        if (!panel.hidden) { panel.hidden = true; return; }
        
        const c = state.currentChatObj;
        panel.innerHTML = `
            <h3 style="margin-top:0; font-size:1.1rem; color:var(--tg-active);">Editar Comunidad</h3>
            <div class="tg-input-group">
                <label>Nombre del Canal/Grupo</label>
                <input type="text" id="edit-tg-title" value="${esc(c.title)}">
            </div>
            <div class="tg-input-group">
                <label>Username Público (@)</label>
                <input type="text" id="edit-tg-username" value="${esc(c.username || '')}" placeholder="ej: mi_pagina_canal">
            </div>
            <div class="tg-input-group">
                <label>Descripción / Info</label>
                <textarea id="edit-tg-desc" rows="4" placeholder="Escribe la biografía del canal...">${esc(c.description || '')}</textarea>
            </div>
            <button id="tg-save-chat-btn" style="background:var(--tg-active); color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; cursor:pointer; margin-top:10px;">💾 Guardar Cambios</button>
            <div id="tg-edit-status" style="font-size:0.85rem; text-align:center; font-weight:600;" hidden></div>
        `;
        panel.hidden = false;
        $('#tg-save-chat-btn').addEventListener('click', saveChatSettings);
    }

    async function saveChatSettings() {
        const btn = $('#tg-save-chat-btn');
        const status = $('#tg-edit-status');
        
        const payload = {
            peerId: state.currentPeer,
            title: $('#edit-tg-title').value.trim(),
            username: $('#edit-tg-username').value.trim().replace('@', ''),
            description: $('#edit-tg-desc').value.trim()
        };

        if (!payload.title) { alert('El título es obligatorio.'); return; }

        btn.disabled = true;
        status.hidden = false;
        status.style.color = 'var(--tg-text)';
        status.textContent = 'Guardando en Telegram...';

        try {
            await api(`/api/admin/group/${encodeURIComponent(state.currentPeer)}/update`, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            
            status.style.color = '#229954';
            status.textContent = '¡Cambios aplicados con éxito!';
            
            state.currentChatObj.title = payload.title;
            state.currentChatObj.username = payload.username;
            state.currentChatObj.description = payload.description;
            
            await loadChats();
            selectChat(state.currentPeer, payload.title);
        } catch (e) {
            status.style.color = '#d35400';
            status.textContent = 'Error: ' + e.message;
        } finally {
            btn.disabled = false;
        }
    }

    async function loadMessages() {
        try {
            const r = await api(`/api/admin/group/${encodeURIComponent(state.currentPeer)}/messages?limit=50`);
            state.messages = r.messages || [];
            renderMessages();
        } catch(e) {
            console.error("Error cargando mensajes:", e);
        }
    }

    function renderMessages() {
        const body = $('#tg-main-body');
        if (!body) return;
        const sorted = state.messages.slice().sort((a, b) => a.id - b.id);
        body.innerHTML = sorted.map(m => {
            let html = esc(m.text || '');
            Object.entries(PREMIUM_EMOJIS).forEach(([e, url]) => { html = html.replaceAll(e, `<img src="${url}" class="tg-premium-emoji">`); });
            return `
                <div class="tg-msg ${m.out ? 'my-msg' : ''}">
                    <div class="tg-msg-actions">
                        <button class="tg-msg-btn" data-action="copy" data-txt="${esc(m.text)}">Copiar</button>
                        <button class="tg-msg-btn" data-action="fwd" data-txt="${esc(m.text)}">Reenviar Limpio</button>
                    </div>
                    <div>${html}</div>
                    <div style="font-size:0.65rem; opacity:0.5; text-align:right; margin-top:4px;">${fmtTime(m.date)}</div>
                </div>`;
        }).join('');
        
        $$('[data-action="copy"]', body).forEach(b => b.addEventListener('click', (e) => { navigator.clipboard.writeText(e.target.dataset.txt); }));
        $$('[data-action="fwd"]', body).forEach(b => b.addEventListener('click', (e) => { state.forwardCache = e.target.dataset.txt; $('#tg-forward-alert').hidden = false; $('#tg-forward-desc').textContent = 'Listo para clonar sin remitente. Selecciona el destino.'; }));
        body.scrollTop = body.scrollHeight;
    }

    async function executeCleanForward(targetPeer) {
        const txt = state.forwardCache; 
        state.forwardCache = null; 
        $('#tg-forward-alert').hidden = true;
        try { 
            await api(`/api/admin/group/${encodeURIComponent(targetPeer)}/message`, { method: 'POST', body: JSON.stringify({ text: txt }) }); 
            selectChat(targetPeer, state.currentTitle); 
        } catch(e) {}
    }

    async function onSendText() {
        const ta = $('#tg-text'); 
        const text = ta.value.trim(); 
        if (!text) return;
        ta.disabled = true;
        try { 
            await api(`/api/admin/group/${encodeURIComponent(state.currentPeer)}/message`, { method: 'POST', body: JSON.stringify({ text }) }); 
            ta.value = ''; 
            await loadMessages(); 
        } catch(e) {} finally { 
            ta.disabled = false; 
            ta.focus(); 
        }
    }

    // Exportación e inicialización segura
    window.TelegramWebPersonal = { open };

    // Ejecución segura de construcción del modal
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildModal);
    } else {
        buildModal();
    }
})();
