/* ===================================================================
 * TELEGRAM PERSONAL PRO (ADMIN EDITION) — Clon Completo e Identidad
 * =================================================================== */
(function () {
    'use strict';

    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

    function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
    function fmtTime(ts) { try { const d = new Date(ts * 1000), now = new Date(); if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' }); } catch { return ''; } }
    function initials(s) { return String(s || '?').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase(); }
    function colorFor(s) { const palette = ['#2471a3', '#2e4053', '#229954', '#d35400', '#884ea4', '#117a65']; let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return palette[Math.abs(h) % palette.length]; }

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
        bots: { label: 'Bots', icon: '🤖' }
    };

    const state = {
        chats: [],
        loaded: false,
        currentPeer: '',
        currentTitle: '',
        messages: [],
        cat: 'all',
        pinned: new Set(),
        theme: localStorage.getItem('tg_pref_theme') || 'telegram',
        forwardCache: null // Guarda el mensaje temporal para reenvío limpio
    };

    // Diccionario de renderizado para simular Emojis Premium de Telegram
    const PREMIUM_EMOJIS = {
        '⚡': 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/26a1.png',
        '🔥': 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f525.png',
        '👑': 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f451.png',
        '💎': 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f48e.png',
        '🚀': 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f680.png',
        '⭐': 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2b50.png'
    };

    function injectStyles() {
        if ($('#tg-web-styles')) return;
        const style = document.createElement('style');
        style.id = 'tg-web-styles';
        style.textContent = `
            #tg-personal { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
            #tg-personal .modal-content { background: var(--tg-bg); color: var(--tg-text); border-radius: 12px; width: 95vw; height: 90vh; max-width: 1400px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.5); border: 1px solid var(--tg-border); position: fixed; top: 5vh; left: 2.5vw; z-index: 10000; }
            #tg-personal .tg-layout { display: flex; flex: 1; overflow: hidden; height: 100%; }
            
            /* Temas visuales ajustables */
            .theme-telegram { --tg-bg: #fff; --tg-text: #333; --tg-border: #dfe5ec; --tg-sidebar-bg: #ffffff; --tg-chat-bg: #f4f4f5; --tg-active: #3390ec; --tg-active-text: #fff; --tg-bubble-in: #f1f1f4; --tg-bubble-out: #eeffde; --tg-bubble-text: #000; }
            .theme-dark { --tg-bg: #181818; --tg-text: #e0e0e0; --tg-border: #2c2c2c; --tg-sidebar-bg: #1e1e1e; --tg-chat-bg: #0f0f0f; --tg-active: #2f6ea7; --tg-active-text: #fff; --tg-bubble-in: #262626; --tg-bubble-out: #2b5278; --tg-bubble-text: #fff; }
            .theme-acestream { --tg-bg: #121214; --tg-text: #e4e4e7; --tg-border: #27272a; --tg-sidebar-bg: #18181b; --tg-chat-bg: #09090b; --tg-active: #ff6000; --tg-active-text: #fff; --tg-bubble-in: #1c1c21; --tg-bubble-out: #3d2213; --tg-bubble-text: #fff; }

            .tg-sidebar { width: 340px; background: var(--tg-sidebar-bg); border-right: 1px solid var(--tg-border); display: flex; flex-direction: column; }
            .tg-main { flex: 1; display: flex; flex-direction: column; background: var(--tg-chat-bg); position: relative; }
            
            .tg-side-head { padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; }
            .tg-search-wrap { padding: 0 12px 10px 12px; }
            .tg-search { width: 100%; width: -webkit-fill-available; padding: 8px 12px; border: 1px solid var(--tg-border); border-radius: 8px; background: var(--tg-bg); color: var(--tg-text); outline: none; }
            
            .tg-cats { display: flex; gap: 4px; overflow-x: auto; padding: 4px 12px; border-bottom: 1px solid var(--tg-border); }
            .tg-cat { border: none; background: transparent; color: var(--tg-text); opacity: 0.7; padding: 6px 10px; border-radius: 6px; cursor: pointer; white-space: nowrap; font-size: 0.85rem; }
            .tg-cat.active { opacity: 1; background: var(--tg-active); color: var(--tg-active-text) !important; font-weight: 600; }
            
            .tg-list { flex: 1; overflow-y: auto; }
            .tg-item { display: flex; align-items: center; padding: 10px 14px; cursor: pointer; gap: 12px; border-bottom: 1px solid var(--tg-border); }
            .tg-item.active { background: var(--tg-active) !important; color: var(--tg-active-text) !important; }
            
            .tg-avatar { width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; color: white; flex-shrink: 0; }
            .tg-item-body { flex: 1; min-width: 0; }
            .tg-item-title { font-weight: 600; font-size: 0.95rem; display: flex; justify-content: space-between; }
            .tg-item-sub { font-size: 0.85rem; color: #71717a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

            /* Burbujas de chat estilo web */
            .tg-main-body { flex: 1; overflow-y: auto; padding: 16px 24px; display: flex; flex-direction: column; gap: 8px; }
            .tg-msg { max-width: 65%; padding: 8px 12px; border-radius: 12px; background: var(--tg-bubble-in); color: var(--tg-bubble-text); align-self: flex-start; box-shadow: 0 1px 2px rgba(0,0,0,0.1); position: relative; group: hover; }
            .tg-msg.my-msg { align-self: flex-end; background: var(--tg-bubble-out); }
            
            /* Acciones flotantes en mensajes */
            .tg-msg-actions { position: absolute; top: -12px; right: 10px; background: var(--tg-sidebar-bg); border: 1px solid var(--tg-border); border-radius: 6px; display: none; gap: 4px; padding: 2px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 10; }
            .tg-msg:hover .tg-msg-actions { display: flex; }
            .tg-msg-btn { background: transparent; border: none; color: var(--tg-text); cursor: pointer; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; }
            .tg-msg-btn:hover { background: var(--tg-active); color: #fff; }

            /* Emojis Grandes Premium */
            .tg-premium-emoji { width: 32px; height: 32px; display: inline-block; vertical-align: middle; margin: 0 2px; animation: pulsePremium 2s infinite ease-in-out; }
            @keyframes pulsePremium { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.15); } }

            .tg-compose { padding: 14px 20px; background: var(--tg-sidebar-bg); border-top: 1px solid var(--tg-border); display: flex; align-items: center; gap: 12px; position: relative; }
            .tg-compose textarea { flex: 1; background: var(--tg-chat-bg); border: 1px solid var(--tg-border); color: var(--tg-text); border-radius: 18px; padding: 10px 16px; resize: none; outline: none; }
            
            /* Panel de Emojis Premium */
            .tg-emoji-panel { position: absolute; bottom: 70px; right: 80px; background: var(--tg-sidebar-bg); border: 1px solid var(--tg-border); border-radius: 8px; padding: 10px; display: flex; gap: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); z-index: 1001; }
            .tg-emoji-pick { font-size: 1.5rem; cursor: pointer; transition: transform 0.1s; }
            .tg-emoji-pick:hover { transform: scale(1.2); }
            
            /* Banner de reenvío en cola */
            .tg-forward-banner { background: var(--tg-active); color: #fff; padding: 8px 16px; display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; }
        `;
        document.head.appendChild(style);
    }

    function _pinKey() { return 'tvp_pinned_sources_' + 'admin'; }
    function loadPinned() { try { state.pinned = new Set(JSON.parse(localStorage.getItem(_pinKey()) || '[]')); } catch { state.pinned = new Set(); } }
    function savePinned() { try { localStorage.setItem(_pinKey(), JSON.stringify(Array.from(state.pinned))); } catch {} }

    function changeTheme(themeName) {
        state.theme = themeName;
        localStorage.setItem('tg_pref_theme', themeName);
        if ($('#tg-personal .modal-content')) $('#tg-personal .modal-content').className = `modal-content tg-card theme-${themeName}`;
    }

    function buildModal() {
        if ($('#tg-personal')) return;
        injectStyles();
        
        const html = `
        <div class="modal" id="tg-personal" hidden>
            <div class="modal-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.4);z-index:9999;" data-tg-close></div>
            <div class="modal-content tg-card theme-${state.theme}">
                <div id="tg-forward-alert" class="tg-forward-banner" hidden>
                    <span id="tg-forward-desc"></span>
                    <button id="tg-forward-cancel" style="background:transparent; border:none; color:#fff; cursor:pointer; font-weight:bold;">✕ Cancelar</button>
                </div>
                <div class="tg-layout">
                    <aside class="tg-sidebar">
                        <header class="tg-side-head">
                            <strong style="font-size:1.1rem;">Gestor Admin Página</strong>
                            <select class="tg-theme-selector" id="tg-theme-select">
                                <option value="telegram">Telegram Blue</option>
                                <option value="dark">Modo Oscuro</option>
                                <option value="acestream">Tema AceStream</option>
                            </select>
                        </header>
                        <div class="tg-search-wrap"><input id="tg-search" class="tg-search" type="search" placeholder="Filtrar canales o grupos..."></div>
                        <div class="tg-cats" id="tg-cats"></div>
                        <div class="tg-list" id="tg-list"></div>
                    </aside>
                    <section class="tg-main">
                        <header class="tg-main-head" id="tg-main-head">
                            <div style="padding:18px; font-weight:600; opacity:0.7;">Selecciona cualquier chat origen o destino</div>
                        </header>
                        <div class="tg-main-body" id="tg-main-body"></div>
                        <footer class="tg-compose" id="tg-compose" hidden>
                            <textarea id="tg-text" rows="1" placeholder="Escribe un mensaje en nombre de tu página..."></textarea>
                            <button class="tg-msg-btn" id="tg-emoji-btn" style="font-size:1.3rem;">👑</button>
                            <div class="tg-emoji-panel" id="tg-emoji-panel" hidden></div>
                            <button id="tg-send" style="background:transparent; border:none; color:var(--tg-active); font-weight:bold; cursor:pointer; padding:0 10px;">Enviar</button>
                        </footer>
                    </section>
                </div>
            </div>
        </div>`;
        
        const w = document.createElement('div'); w.innerHTML = html;
        document.body.appendChild(w.firstElementChild);
        
        $('#tg-theme-select').value = state.theme;
        $('#tg-theme-select').addEventListener('change', (e) => changeTheme(e.target.value));
        $('#tg-forward-cancel').addEventListener('click', cancelForward);
        
        renderCats();
        wire();
        buildEmojiPanel();
    }

    function buildEmojiPanel() {
        const panel = $('#tg-emoji-panel');
        panel.innerHTML = Object.keys(PREMIUM_EMOJIS).map(e => `<span class="tg-emoji-pick" data-emoji="${e}">${e}</span>`).join('');
        $$('.tg-emoji-pick', panel).forEach(el => {
            el.addEventListener('click', () => {
                $('#tg-text').value += el.dataset.emoji;
                panel.hidden = true;
                $('#tg-text').focus();
            });
        });
    }

    function renderCats() {
        $('#tg-cats').innerHTML = Object.entries(CATS).map(([k, v]) => `
            <button class="tg-cat${state.cat === k ? ' active' : ''}" data-cat="${k}">${v.label}</button>`).join('');
        $$('#tg-cats .tg-cat').forEach(b => b.addEventListener('click', () => { state.cat = b.dataset.cat; renderCats(); renderList(); }));
    }

    function wire() {
        $$('#tg-personal [data-tg-close]').forEach(el => el.addEventListener('click', close));
        $('#tg-search').addEventListener('input', renderList);
        $('#tg-send').addEventListener('click', onSendText);
        $('#tg-emoji-btn').addEventListener('click', () => { $('#tg-emoji-panel').hidden = !$('#tg-emoji-panel').hidden; });
        $('#tg-text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendText(); } });
    }

    async function open() { buildModal(); $('#tg-personal').hidden = false; loadPinned(); await loadChats(); }
    function close() { $('#tg-personal').hidden = true; }

    async function loadChats() { try { const r = await api('/api/admin/groups'); state.chats = r.groups || []; renderList(); } catch {} }

    function renderList() {
        const list = $('#tg-list');
        const q = ($('#tg-search').value || '').toLowerCase();
        const items = state.chats.filter(c => {
            if (state.cat === 'sources' && !state.pinned.has(c.peerId)) return false;
            if (state.cat === 'admin' && !c.isAdmin) return false;
            if (state.cat !== 'all' && state.cat !== 'sources' && state.cat !== 'admin' && c.category !== state.cat) return false;
            return !q || c.title.toLowerCase().includes(q);
        });
        list.innerHTML = items.map(c => `
            <div class="tg-item${state.currentPeer === c.peerId ? ' active' : ''}" data-peer="${c.peerId}" data-title="${c.title}">
                <div class="tg-avatar" style="background:${colorFor(c.title)}">${initials(c.title)}</div>
                <div class="tg-item-body">
                    <div class="tg-item-title">${esc(c.title)}</div>
                    <div class="tg-item-sub">${esc(c.username ? '@' + c.username : 'Canal/Grupo')}</div>
                </div>
            </div>`).join('');
        $$('.tg-item', list).forEach(el => el.addEventListener('click', () => selectChat(el.dataset.peer, el.dataset.title)));
    }

    async function selectChat(peer, title) {
        state.currentPeer = peer; state.currentTitle = title;
        $('#tg-compose').hidden = false;
        
        // Si hay un reenvío pendiente en caché, lo inyecta limpiamente de inmediato al cambiar al chat de destino
        if (state.forwardCache) {
            await executeCleanForward(peer);
            return;
        }

        $('#tg-main-head').innerHTML = `
            <div style="padding:14px 20px; border-bottom:1px solid var(--tg-border); background: var(--tg-sidebar-bg); display:flex; justify-content:space-between; align-items:center;">
                <div><strong>${esc(title)}</strong><br><small>${esc(peer)}</small></div>
                <button id="tg-pin-toggle" class="tg-theme-selector">${state.pinned.has(peer) ? '★ Quitar Fuente' : '☆ Marcar Fuente'}</button>
            </div>`;
        $('#tg-pin-toggle').addEventListener('click', () => { if (state.pinned.has(peer)) state.pinned.delete(peer); else state.pinned.add(peer); savePinned(); selectChat(peer, title); });
        
        renderList();
        await loadMessages();
    }

    async function loadMessages() {
        try {
            const r = await api(`/api/admin/group/${encodeURIComponent(state.currentPeer)}/messages?limit=50`);
            state.messages = r.messages || [];
            renderMessages();
        } catch {}
    }

    function renderMessages() {
        const body = $('#tg-main-body');
        const sorted = state.messages.slice().sort((a, b) => a.id - b.id);
        
        body.innerHTML = sorted.map(m => {
            let html = esc(m.text || '');
            
            // Parser de Emojis Premium a imágenes HD
            Object.entries(PREMIUM_EMOJIS).forEach(([emoji, url]) => {
                html = html.replaceAll(emoji, `<img src="${url}" class="tg-premium-emoji" title="Premium ${emoji}">`);
            });

            return `
                <div class="tg-msg ${m.out ? 'my-msg' : ''}" data-id="${m.id}">
                    <div class="tg-msg-actions">
                        <button class="tg-msg-btn data-action="copy" data-txt="${esc(m.text)}">Copiar</button>
                        <button class="tg-msg-btn" data-action="fwd" data-txt="${esc(m.text)}">Reenviar Limpio</button>
                    </div>
                    <div>${html}</div>
                    <div style="font-size:0.65rem; opacity:0.5; text-align:right; margin-top:4px;">${fmtTime(m.date)}</div>
                </div>`;
        }).join('');

        // Eventos rápidos sobre las burbujas
        $$('[data-action="copy"]', body).forEach(b => b.addEventListener('click', (e) => { navigator.clipboard.writeText(e.target.dataset.txt); alert('Texto copiado.'); }));
        $$('[data-action="fwd"]', body).forEach(b => b.addEventListener('click', (e) => prepareForward(e.target.dataset.txt)));

        body.scrollTop = body.scrollHeight;
    }

    // Configura el mensaje en memoria intermedia eliminando remitentes originales
    function prepareForward(text) {
        state.forwardCache = text;
        $('#tg-forward-alert').hidden = false;
        $('#tg-forward-desc').textContent = `Contenido listo para clonar de forma anónima. Selecciona ahora el grupo o canal de destino.`;
    }

    function cancelForward() { state.forwardCache = null; $('#tg-forward-alert').hidden = true; }

    // Envía el mensaje de manera 100% limpia sin cabeceras "Reenviado de:"
    async function executeCleanForward(targetPeer) {
        const textToSend = state.forwardCache;
        cancelForward();
        try {
            await api(`/api/admin/group/${encodeURIComponent(targetPeer)}/message`, {
                method: 'POST',
                body: JSON.stringify({ text: textToSend })
            });
            await selectChat(targetPeer, state.currentTitle);
        } catch { alert('Error al procesar el reenvío anónimo.'); }
    }

    async function onSendText() {
        const ta = $('#tg-text'); const text = ta.value.trim(); if (!text) return;
        ta.disabled = true;
        try {
            await api(`/api/admin/group/${encodeURIComponent(state.currentPeer)}/message`, { method: 'POST', body: JSON.stringify({ text }) });
            ta.value = ''; await loadMessages();
        } catch {} finally { ta.disabled = false; ta.focus(); }
    }

    window.TelegramWebPersonal = { open, close };
})();
