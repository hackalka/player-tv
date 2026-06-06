// ===== CONFIG & STATE =====
const state = {
    channels: [],
    categories: {},
    currentChannel: null,
    isLoading: true,
    searchQuery: '',
    tgClient: null
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
    bootStatus: $('#boot-status')
};

// ===== TELEGRAM API ENGINE =====
class TelegramEngine {
    constructor(config) {
        this.apiId = config.apiId;
        this.apiHash = config.apiHash;
        this.channelId = config.channelId;
        this.client = null;
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
            return true;
        } catch (e) {
            console.error("Error en init:", e);
            if (elements.bootStatus) elements.bootStatus.innerText = "Error: " + e.message;
            return false;
        }
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
        try {
            const entity = await this.client.getEntity(this.channelId);
            // Intentamos obtener tópicos si es un grupo, o mensajes normales si es un canal
            let messages = [];

            try {
                // Intento de obtener mensajes recientes
                messages = await this.client.getMessages(entity, { limit: 100 });
            } catch (e) {
                console.warn("Error fetching messages:", e);
            }

            return this.parseMessages(messages);
        } catch (e) {
            console.error("Fetch error:", e);
            return [];
        }
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
                <button class="card-action-btn info-btn"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg></button>
            </div>
        `;

        card.querySelector('.play-btn').onclick = (e) => { e.stopPropagation(); this.openPlayer(item); };
        card.onclick = () => this.openPlayer(item);
        return card;
    },

    createRow(title, items) {
        const row = document.createElement('section');
        row.className = 'content-row';
        row.innerHTML = `
            <div class="row-header"><h2 class="row-title">${title}</h2></div>
            <div class="row-slider">
                <button class="slider-arrow prev"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg></button>
                <div class="slider-track"></div>
                <button class="slider-arrow next"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg></button>
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
        elements.playerIframe.src = item.embedUrl;
        elements.modalTitle.innerText = item.title;
        elements.modalDescription.innerText = item.description;
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
        const connected = await engine.init();

        if (!connected) {
            console.warn('No conectado a Telegram');
            return;
        }

        console.log('✅ Conectado a Telegram');
        
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
        if (content.length > 0) UI.updateHero(content[0]);

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