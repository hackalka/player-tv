// ===== CONFIG & STATE =====
const state = {
    channels: [],
    categories: {},
    currentChannel: null,
    isLoading: true,
    searchQuery: '',
    tgClient: null,
    engine: null,      // referencia al TelegramEngine activo
    me: null,          // usuario logueado (getMe)
    isOwner: false     // true solo si el usuario logueado es el propietario
};

// ===== STORAGE KEYS =====
const STORAGE = {
    sources: 'source_groups',     // grupos fuente seleccionados por el propietario
    target: 'target_group',       // grupo destino de los reenvios
    forwarded: 'forwarded_log'     // ids ya reenviados (dedupe)
};

// ===== DOM ELEMENTS =====
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const elements = {
    navbar: $('.navbar'),
    hero: $('#hero'),
    heroImage: $('#hero-image'),
    heroTitle: $('#hero-title'),
    heroDescription: $('#hero-description'),
    heroPlay: $('#hero-play'),
    heroInfo: $('#hero-info'),
    rowsContainer: $('#rows-container'),
    playerModal: $('#player-modal'),
    playerIframe: $('#player-iframe'),
    modalTitle: $('#modal-title'),
    modalDescription: $('#modal-description'),
    modalYear: $('#modal-year'),
    modalDuration: $('#modal-duration'),
    searchBtn: $('.search-btn'),
    searchOverlay: $('#search-overlay'),
    searchInput: $('#search-input'),
    searchResults: $('#search-results'),
    loadingScreen: $('#loading-screen'),
    loginModal: $('#login-modal'),
    qrCode: $('#qr-code'),
    qrLoading: $('#qr-loading'),
    bootStatus: $('#boot-status'),
    // Panel admin
    adminBtn: $('#admin-btn'),
    adminModal: $('#admin-modal'),
    adminClose: $('#admin-close'),
    adminWhoami: $('#admin-whoami'),
    adminGroupList: $('#admin-group-list'),
    adminTarget: $('#admin-target'),
    adminReload: $('#admin-reload'),
    adminSave: $('#admin-save'),
    adminStatus: $('#admin-status')
};

// ===== TELEGRAM API ENGINE =====
class TelegramEngine {
    constructor(config) {
        this.apiId = config.apiId;
        this.apiHash = config.apiHash;
        this.channelId = config.channelId;
        this.targetGroup = config.targetGroup || config.channelId;
        this.ownerId = config.ownerId ? String(config.ownerId) : '';
        this.ownerUsername = (config.ownerUsername || '').replace(/^@/, '').toLowerCase();
        this.client = null;
        this.me = null;
    }

    async init() {
        // Esperar a que telegram esté listo (con reintentos)
        let attempts = 0;
        while ((!window.telegram || typeof window.telegram !== 'object') && attempts < 20) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }

        if (!window.telegram || !window.telegram.TelegramClient) {
            console.error("❌ Librería de Telegram no se cargó. Verifica tu conexión a internet.");
            if (elements.bootStatus) elements.bootStatus.innerText = "Error: No se pudo cargar Telegram";
            return false;
        }

        try {
            const { TelegramClient, sessions } = window.telegram;
            const sessionString = SafeStorage.getItem('tg_session') || '';
            const session = new sessions.StringSession(sessionString);

            this.client = new TelegramClient(session, this.apiId, this.apiHash, {
                connectionRetries: 5,
                useWSS: true
            });

            if (elements.bootStatus) elements.bootStatus.innerText = "Conectando con Telegram...";
            await this.client.connect();

            if (!await this.client.checkAuthorization()) {
                if (elements.bootStatus) elements.bootStatus.innerText = "Escanea el código QR";
                await this.showLogin();
                return false;
            }

            SafeStorage.setItem('tg_session', this.client.session.save());
            if (elements.loginModal) elements.loginModal.hidden = true;

            // Detectar usuario logueado y si es el propietario
            try {
                this.me = await this.client.getMe();
                state.me = this.me;
                state.isOwner = this.isOwner();
            } catch (e) {
                console.warn('No se pudo obtener getMe:', e);
            }

            return true;
        } catch (e) {
            console.error("Error en init:", e);
            if (elements.bootStatus) elements.bootStatus.innerText = "Error: " + e.message;
            return false;
        }
    }

    // ===== PROPIETARIO =====
    // Devuelve true si el usuario logueado coincide con ownerId/ownerUsername.
    // Si NO hay propietario configurado, devuelve true (modo configuracion) para
    // que el propietario pueda ver su ID en el panel y fijarlo en config.js.
    isOwner() {
        if (!this.me) return false;
        const noOwnerConfigured = !this.ownerId && !this.ownerUsername;
        if (noOwnerConfigured) return true;
        const myId = String(this.me.id);
        const myUser = (this.me.username || '').toLowerCase();
        if (this.ownerId && myId === this.ownerId) return true;
        if (this.ownerUsername && myUser === this.ownerUsername) return true;
        return false;
    }

    ownerConfigured() {
        return Boolean(this.ownerId || this.ownerUsername);
    }

    // ===== GRUPOS DEL USUARIO =====
    // Lista todos los grupos/canales en los que esta suscrito el usuario logueado.
    async getMisGrupos() {
        const dialogs = await this.client.getDialogs({ limit: 200 });
        return dialogs
            .filter(d => d.isGroup || d.isChannel)
            .map(d => ({ id: String(d.id), title: d.title || d.name || '(sin nombre)' }));
    }

    // ===== REENVIO (estilo Telegram) =====
    // Reenvia el mensaje marcado al grupo destino, conservando el origen.
    async forwardToMyGroup(item) {
        const target = SafeStorage.getItem(STORAGE.target) || this.targetGroup;
        if (!target) throw new Error('No hay grupo destino configurado');
        if (!item.sourceId) throw new Error('El mensaje no tiene grupo de origen');

        const fromPeer = await this.client.getEntity(item.sourceId);
        const toPeer = await this.client.getEntity(target);
        await this.client.forwardMessages(toPeer, {
            messages: [Number(item.id)],
            fromPeer
        });

        // Dedupe
        const log = JSON.parse(SafeStorage.getItem(STORAGE.forwarded) || '[]');
        const key = `${item.sourceId}:${item.id}`;
        if (!log.includes(key)) {
            log.push(key);
            SafeStorage.setItem(STORAGE.forwarded, JSON.stringify(log));
        }
        return true;
    }

    async showLogin() {
        if (!elements.loginModal) return;
        
        elements.loginModal.hidden = false;
        if (elements.qrLoading) elements.qrLoading.style.display = 'block';
        if (elements.qrCode) elements.qrCode.innerHTML = '';

        try {
            await this.client.signInUserWithQrCode({ apiId: this.apiId, apiHash: this.apiHash }, {
                qrCode: async (code) => {
                    const url = `tg://login?token=${code.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
                    if (window.qrcode) {
                        const qr = qrcode(0, 'M');
                        qr.addData(url);
                        qr.make();
                        if (elements.qrLoading) elements.qrLoading.style.display = 'none';
                        if (elements.qrCode) elements.qrCode.innerHTML = qr.createSvgTag({ cellSize: 4 });
                    }
                }
            });
            location.reload();
        } catch (e) {
            console.error("QR Error:", e);
            if (elements.bootStatus) elements.bootStatus.innerText = "Error: " + e.message;
        }
    }

    async fetchContent() {
        // Fuentes: las que el propietario haya guardado, o el canal por defecto.
        let sources = [];
        try {
            sources = JSON.parse(SafeStorage.getItem(STORAGE.sources) || '[]');
        } catch (e) { sources = []; }
        if (!Array.isArray(sources) || sources.length === 0) {
            sources = [this.channelId];
        }

        let all = [];
        for (const src of sources) {
            try {
                const entity = await this.client.getEntity(src);
                const messages = await this.client.getMessages(entity, { limit: 100 });
                const parsed = this.parseMessages(messages).map(item => ({ ...item, sourceId: String(src) }));
                all = all.concat(parsed);
            } catch (e) {
                console.warn(`No se pudo leer la fuente ${src}:`, e);
            }
        }
        return all;
    }

    parseMessages(messages) {
        return messages
            .filter(m => m.message && (m.message.includes('http') || m.media))
            .map(m => {
                const lines = m.message.split('\n');
                const title = lines[0].replace(/#\w+/g, '').trim() || 'Sin título';
                const description = lines.slice(1).join(' ').substring(0, 150) + '...';

                // Extraer miniatura (link de imagen en el texto o media adjunta)
                let thumbnail = 'https://picsum.photos/400/600?random=' + m.id;
                const imgMatch = m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i);
                if (imgMatch) {
                    thumbnail = imgMatch[0];
                }

                // Extraer link de reproducción (embed o directo)
                let embedUrl = '';
                const urlMatch = m.message.match(/https?:\/\/[^\s]+/);
                if (urlMatch) {
                    embedUrl = urlMatch[0];
                }

                return {
                    id: m.id,
                    title: title,
                    description: description,
                    thumbnail: thumbnail,
                    category: this.inferCategory(title, m.message),
                    year: this.extractYear(m.message),
                    duration: 'N/A',
                    embedUrl: embedUrl
                };
            });
    }

    inferCategory(title, text) {
        const t = (title + text).toLowerCase();
        if (t.includes('película') || t.includes('movie')) return 'Películas';
        if (t.includes('serie') || t.includes('temporada')) return 'Series';
        if (t.includes('deporte') || t.includes('fútbol')) return 'Deportes';
        if (t.includes('música') || t.includes('video')) return 'Música';
        return 'Otros';
    }

    extractYear(text) {
        const yearMatch = text.match(/\b(19|20)\d{2}\b/);
        return yearMatch ? yearMatch[0] : '';
    }
}

// ===== UI COMPONENTS =====
const UI = {
    createCard(item) {
        const card = document.createElement('div');
        card.className = 'card';
        const forwardBtn = state.isOwner
            ? `<button class="card-action-btn forward-btn" title="Reenviar a mi grupo"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/></svg></button>`
            : '';
        card.innerHTML = `
            <img class="card-image" src="${item.thumbnail}" alt="${item.title}" loading="lazy">
            <div class="card-overlay">
                <h3 class="card-title">${item.title}</h3>
                <div class="card-meta">
                    <span>${item.year}</span>
                </div>
            </div>
            <div class="card-actions">
                <button class="card-action-btn primary play-btn"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></button>
                ${forwardBtn}
                <button class="card-action-btn info-btn"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg></button>
            </div>
        `;

        card.querySelector('.play-btn').onclick = (e) => { e.stopPropagation(); this.openPlayer(item); };
        const fwd = card.querySelector('.forward-btn');
        if (fwd) {
            fwd.onclick = (e) => { e.stopPropagation(); this.handleForward(item, fwd); };
        }
        card.onclick = () => this.openPlayer(item);
        return card;
    },

    async handleForward(item, btn) {
        if (!state.isOwner || !state.engine) return;
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '…';
        try {
            await state.engine.forwardToMyGroup(item);
            btn.innerHTML = '✓';
            btn.classList.add('done');
        } catch (e) {
            console.error('Error al reenviar:', e);
            btn.innerHTML = '✕';
            alert('No se pudo reenviar: ' + e.message);
            setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 1500);
        }
    },

    createRow(title, items) {
        const row = document.createElement('section');
        row.className = 'content-row';
        row.innerHTML = `
            <div class="row-header"><h2 class="row-title">${title}</h2></div>
            <div class="row-slider">
                <button class="slider-arrow prev" aria-label="Desplazar a la izquierda"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg></button>
                <div class="slider-track"></div>
                <button class="slider-arrow next" aria-label="Desplazar a la derecha"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg></button>
            </div>
        `;

        const track = row.querySelector('.slider-track');
        items.forEach(item => track.appendChild(this.createCard(item)));
        this.initSlider(row);
        return row;
    },

    initSlider(row) {
        const track = row.querySelector('.slider-track');
        row.querySelector('.prev').onclick = () => track.scrollBy({ left: -800, behavior: 'smooth' });
        row.querySelector('.next').onclick = () => track.scrollBy({ left: 800, behavior: 'smooth' });
    },

    openPlayer(item) {
        if (!item.embedUrl) return;
        elements.playerIframe.src = item.embedUrl;
        elements.modalTitle.innerText = item.title;
        elements.modalDescription.innerText = item.description;
        elements.modalYear.innerText = item.year || 'Desconocido';
        elements.modalDuration.innerText = item.duration || 'N/A';
        elements.playerModal.hidden = false;
        document.body.style.overflow = 'hidden';
    },

    closePlayer() {
        elements.playerIframe.src = '';
        elements.playerModal.hidden = true;
        document.body.style.overflow = '';
    },

    updateHero(item) {
        if (!item) return;
        elements.heroImage.src = item.thumbnail;
        elements.heroTitle.innerText = item.title;
        elements.heroDescription.innerText = item.description;
        elements.heroPlay.onclick = () => this.openPlayer(item);
        elements.heroInfo.onclick = () => this.openPlayer(item);
    },

    startHeroRotation(items) {
        if (!window.CONFIG.heroAutoRotate || !items.length) return;
        let currentIndex = 0;
        setInterval(() => {
            currentIndex = (currentIndex + 1) % items.length;
            this.updateHero(items[currentIndex]);
        }, window.CONFIG.heroRotateInterval || 10000);
    },

    renderSearchResults(results) {
        if (!elements.searchResults) return;
        if (!results.length) {
            elements.searchResults.innerHTML = '<div class="search-empty">No se encontraron resultados para tu búsqueda.</div>';
            return;
        }

        elements.searchResults.innerHTML = '';
        results.forEach(item => {
            const card = document.createElement('div');
            card.className = 'search-card';
            card.innerHTML = `
                <img class="search-image" src="${item.thumbnail}" alt="${item.title}" loading="lazy">
                <div class="search-meta">
                    <h3>${item.title}</h3>
                    <p>${item.description}</p>
                </div>
            `;
            card.onclick = () => this.openPlayer(item);
            elements.searchResults.appendChild(card);
        });
    },

    openSearch() {
        if (!elements.searchOverlay) return;
        elements.searchOverlay.hidden = false;
        elements.searchInput.focus();
        document.body.style.overflow = 'hidden';
    },

    closeSearch() {
        if (!elements.searchOverlay) return;
        elements.searchOverlay.hidden = true;
        elements.searchInput.value = '';
        elements.searchResults.innerHTML = '';
        document.body.style.overflow = '';
    },

    searchContent(query) {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return [];
        return state.channels.filter(item => {
            return item.title.toLowerCase().includes(normalized) || item.description.toLowerCase().includes(normalized) || item.category.toLowerCase().includes(normalized);
        });
    }
};

// ===== ADMIN PANEL (solo propietario) =====
const AdminPanel = {
    grupos: [],

    setup() {
        const owner = state.isOwner;
        // El boton de admin solo se muestra al propietario
        if (elements.adminBtn) {
            elements.adminBtn.style.display = owner ? 'flex' : 'none';
            elements.adminBtn.onclick = () => this.open();
        }
        if (!owner) return;

        if (elements.adminClose) elements.adminClose.onclick = () => this.close();
        if (elements.adminModal) {
            const overlay = elements.adminModal.querySelector('.modal-overlay');
            if (overlay) overlay.onclick = () => this.close();
        }
        if (elements.adminReload) elements.adminReload.onclick = () => this.loadGroups();
        if (elements.adminSave) elements.adminSave.onclick = () => this.save();
    },

    async open() {
        if (!state.isOwner || !elements.adminModal) return;
        elements.adminModal.hidden = false;
        document.body.style.overflow = 'hidden';

        // Mostrar identidad del propietario (util para configurar config.js)
        const me = state.me;
        if (elements.adminWhoami && me) {
            const configured = state.engine.ownerConfigured();
            elements.adminWhoami.innerHTML = configured
                ? `Conectado como <b>@${me.username || '—'}</b> (ID: ${me.id})`
                : `⚠️ Sin propietario fijado. Tu ID: <b>${me.id}</b> · usuario: <b>@${me.username || '—'}</b>.<br>Cópialo en <code>config.js</code> (ownerId) para que solo tú accedas.`;
        }

        // Restaurar grupo destino guardado
        if (elements.adminTarget) {
            elements.adminTarget.value = SafeStorage.getItem(STORAGE.target) || window.CONFIG.targetGroup || '';
        }

        await this.loadGroups();
    },

    close() {
        if (!elements.adminModal) return;
        elements.adminModal.hidden = true;
        document.body.style.overflow = '';
    },

    async loadGroups() {
        if (!elements.adminGroupList) return;
        elements.adminGroupList.innerHTML = '<p class="admin-hint">Cargando tus grupos…</p>';
        try {
            this.grupos = await state.engine.getMisGrupos();
        } catch (e) {
            elements.adminGroupList.innerHTML = '<p class="admin-hint">Error al cargar grupos: ' + e.message + '</p>';
            return;
        }

        let selected = [];
        try { selected = JSON.parse(SafeStorage.getItem(STORAGE.sources) || '[]'); } catch (e) { selected = []; }

        if (!this.grupos.length) {
            elements.adminGroupList.innerHTML = '<p class="admin-hint">No se encontraron grupos.</p>';
            return;
        }

        elements.adminGroupList.innerHTML = '';
        this.grupos.forEach(g => {
            const row = document.createElement('label');
            row.className = 'admin-group-row';
            const checked = selected.includes(g.id) ? 'checked' : '';
            row.innerHTML = `
                <input type="checkbox" value="${g.id}" ${checked}>
                <span class="admin-group-title">${g.title}</span>
                <span class="admin-group-id">${g.id}</span>
            `;
            elements.adminGroupList.appendChild(row);
        });
    },

    save() {
        // Guardar fuentes seleccionadas
        const checks = elements.adminGroupList.querySelectorAll('input[type="checkbox"]:checked');
        const sources = Array.from(checks).map(c => c.value);
        SafeStorage.setItem(STORAGE.sources, JSON.stringify(sources));

        // Guardar grupo destino
        const target = (elements.adminTarget.value || '').trim();
        SafeStorage.setItem(STORAGE.target, target || window.CONFIG.targetGroup || window.CONFIG.channelId);

        if (elements.adminStatus) {
            elements.adminStatus.innerText = `Guardado: ${sources.length} grupo(s) fuente. Recargando contenido…`;
        }
        // Recargar el contenido con las nuevas fuentes
        setTimeout(() => location.reload(), 900);
    }
};

// ===== APP CORE =====
async function init() {
    try {
        console.log('Inicializando app con CONFIG:', window.CONFIG);
        
        if (!window.CONFIG) {
            throw new Error('CONFIG no está definido');
        }

        const engine = new TelegramEngine(window.CONFIG);
        state.engine = engine;
        const connected = await engine.init();

        if (!connected) {
            console.warn('No conectado a Telegram');
            return;
        }

        console.log('✅ Conectado a Telegram');

        // Mostrar/ocultar el panel admin segun el propietario
        AdminPanel.setup();
        
        const content = await engine.fetchContent();
        state.channels = content;

        if (!Array.isArray(content) || content.length === 0) {
            console.warn('No hay contenido disponible');
            if (elements.bootStatus) elements.bootStatus.innerText = "No hay contenido disponible";
            return;
        }

        // Categorizar
        const cats = content.reduce((acc, item) => {
            if (!acc[item.category]) acc[item.category] = [];
            acc[item.category].push(item);
            return acc;
        }, {});

        if (elements.rowsContainer) elements.rowsContainer.innerHTML = '';

        // Hero
        if (content.length > 0) {
            UI.updateHero(content[0]);
            UI.startHeroRotation(content);
        }

        // Render rows
        Object.entries(cats).forEach(([name, items]) => {
            if (elements.rowsContainer) {
                elements.rowsContainer.appendChild(UI.createRow(name, items));
            }
        });

    } catch (e) {
        console.error("App init error:", e);
        if (elements.bootStatus) elements.bootStatus.innerText = "Error: " + e.message;
    } finally {
        if (elements.loadingScreen) elements.loadingScreen.classList.add('hidden');
    }
}

// Event Listeners
if (elements.playerModal && elements.playerModal.querySelector('.modal-close')) {
    elements.playerModal.querySelector('.modal-close').onclick = () => UI.closePlayer();
}
if (elements.playerModal && elements.playerModal.querySelector('.modal-overlay')) {
    elements.playerModal.querySelector('.modal-overlay').onclick = () => UI.closePlayer();
}

if (elements.searchBtn) {
    elements.searchBtn.onclick = () => UI.openSearch();
}
if (elements.searchOverlay && elements.searchOverlay.querySelector('.search-close')) {
    elements.searchOverlay.querySelector('.search-close').onclick = () => UI.closeSearch();
}
if (elements.searchInput) {
    elements.searchInput.addEventListener('input', (event) => {
        const query = event.target.value;
        const results = UI.searchContent(query);
        UI.renderSearchResults(results);
    });
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.searchOverlay && !elements.searchOverlay.hidden) {
        UI.closeSearch();
    }
});

window.addEventListener('scroll', () => {
    if (elements.navbar) {
        if (window.scrollY > 50) elements.navbar.classList.add('scrolled');
        else elements.navbar.classList.remove('scrolled');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // Esperar a que las librerías se carguen
    let readyCheck = setInterval(() => {
        if (window.telegram && window.telegram.TelegramClient) {
            clearInterval(readyCheck);
            console.log('✅ Librerías cargadas, iniciando app...');
            setTimeout(init, 500);
        }
    }, 500);

    // Timeout después de 15 segundos
    setTimeout(() => {
        clearInterval(readyCheck);
        if (!window.telegram) {
            console.error('Timeout: Telegram no se cargó en 15 segundos');
            if (elements.bootStatus) elements.bootStatus.innerText = "Timeout cargando librerías";
        }
    }, 15000);
});