/**
 * PLAYER TV - Telegram Client Engine (Master Edition)
 * Optimized for performance, security and UX.
 */

// Obfuscated configuration to avoid bots scraping API credentials
const _0x5a2 = ["ODk1Mjc0MQ==", "NjkzZmIyZGExMjQ2NjJkYWQ4NWIyYjMzN2M1M2EzODY="];
const apiId = parseInt(atob(_0x5a2[0]));
const apiHash = atob(_0x5a2[1]);

let client = null;
let loginResolver = null;
let step = 'phone';
let isLoadingTelegram = false;

/**
 * Robust Initialization Engine
 */
async function initGramJS() {
    if (!window.telegram || !window.Buffer) {
        console.warn("⏳ Waiting for Telegram/Buffer libraries...");
        setTimeout(initGramJS, 500);
        return;
    }

    const { TelegramClient } = window.telegram;
    const { StringSession } = window.telegram.sessions;

    const stringSession = new StringSession(localStorage.getItem('tg_session') || "");

    client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: true,
        autoReconnect: true,
    });

    console.log("🚀 [Master] Engine Initialized");
    conectarTelegram();
}

/**
 * Secure Authentication Logic
 */
async function conectarTelegram() {
    try {
        await client.connect();
        const isAuth = await client.checkAuthorization();

        if (!isAuth) {
            console.log("🔐 Authorization required");
            const modal = document.getElementById('login-modal');
            if (modal) modal.style.display = 'flex';

            await client.start({
                phoneNumber: async () => {
                    step = 'phone';
                    return new Promise(resolve => { loginResolver = resolve; });
                },
                phoneCode: async () => {
                    step = 'code';
                    actualizarUI();
                    return new Promise(resolve => { loginResolver = resolve; });
                },
                password: async () => {
                    step = '2fa';
                    actualizarUI();
                    return new Promise(resolve => { loginResolver = resolve; });
                },
                onError: (err) => {
                    console.error("Auth Error:", err);
                    alert("Telegram Error: " + (err.message || "Unknown error"));
                    localStorage.removeItem('tg_session');
                    location.reload();
                },
            });

            localStorage.setItem('tg_session', client.session.save());
            if (modal) modal.style.display = 'none';
        }

        console.log("✅ [Master] Authorized & Connected");
        inicializarContenidoTelegram();

    } catch (e) {
        console.error("❌ Critical Connection Error:", e);
        if (e.message?.includes("AUTH_KEY_UNREGISTERED")) {
            localStorage.removeItem('tg_session');
            location.reload();
        }
    }
}

/**
 * UI State Management for Login
 */
function actualizarUI() {
    const phoneInput = document.getElementById('phone-input');
    const codeInput = document.getElementById('code-input');
    const faInput = document.getElementById('2fa-input');
    const msg = document.getElementById('login-msg');

    if (phoneInput) phoneInput.style.display = step === 'phone' ? 'block' : 'none';
    if (codeInput) codeInput.style.display = step === 'code' ? 'block' : 'none';
    if (faInput) faInput.style.display = step === '2fa' ? 'block' : 'none';

    if (msg) {
        if (step === 'code') msg.innerHTML = "Código enviado a tu Telegram. <br> Introdúcelo aquí:";
        if (step === '2fa') msg.innerHTML = "Tu cuenta tiene Verificación en 2 pasos. <br> Introduce tu contraseña:";
    }
}

function iniciarLogin() {
    const val = step === 'phone' ? document.getElementById('phone-input')?.value :
                step === 'code' ? document.getElementById('code-input')?.value :
                document.getElementById('2fa-input')?.value;

    if (loginResolver && val) loginResolver(val);
}

/**
 * Content Engine: Optimized Fetch & Sync
 */
async function inicializarContenidoTelegram() {
    if (isLoadingTelegram) return;
    isLoadingTelegram = true;

    const channelId = "gran_player";
    try {
        const entity = await client.getEntity(channelId);
        const { Api } = window.telegram;

        // Fetch full channel to get topics
        const fullChannel = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        const topics = fullChannel.fullChat.topics?.topics || [];

        console.log(`📂 Processing ${topics.length} topics from @${channelId}`);

        // Use a chunked parallel approach to avoid flood limits
        const chunkSize = 3;
        for (let i = 0; i < topics.length; i += chunkSize) {
            const chunk = topics.slice(i, i + chunkSize);
            await Promise.all(chunk.map(topic => cargarMensajesDeTopic(entity, topic)));
        }

        console.log("✨ [Master] Content sync complete");
        if (typeof render === 'function') render(filtroActual);
    } catch (e) {
        console.error("❌ Content Sync Failed:", e);
    } finally {
        isLoadingTelegram = false;
    }
}

async function cargarMensajesDeTopic(entity, topic) {
    try {
        const messages = await client.getMessages(entity, {
            replyTo: topic.id,
            limit: 50
        });

        messages.forEach(m => {
            if (!m.message) return;

            const texto = m.message.toLowerCase();
            let cat = "inicio";

            if (texto.includes("#pelicula")) cat = "peliculas";
            else if (texto.includes("#serie")) cat = "series";
            else if (texto.includes("#directo")) cat = "directos";
            else if (texto.includes("#agenda")) cat = "agenda";

            // Clean title: first line, remove hashtags
            const lines = m.message.split('\n');
            const titulo = lines[0].replace(/#\w+/g, '').trim();

            if (!titulo) return;

            const link = extraerEnlace(m.message);

            if (link && !itemExiste(cat, titulo)) {
                base[cat].push({
                    titulo: titulo,
                    link: link,
                    portada: extraerPortada(m),
                    sinopsis: extraerSinopsis(m.message),
                    catAsignada: cat,
                    id: m.id.toString(),
                    extra: cat === 'agenda' ? extraerExtraAgenda(m.message) : ""
                });
            }
        });
    } catch (err) {
        console.warn(`⚠️ Error loading topic ${topic.id}:`, err);
    }
}

function extraerEnlace(msg) {
    const ace = msg.match(/[a-f0-9]{40}/);
    if (ace) return "acestream://" + ace[0];
    const url = msg.match(/https?:\/\/[^\s]+/);
    return url ? url[0] : null;
}

function extraerExtraAgenda(msg) {
    const match = msg.match(/\d{2}:\d{2}/);
    return match ? "EVENTO " + match[0] : "";
}

function extraerPortada(m) {
    // Priority 1: Link in text
    const urlImg = m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i);
    if (urlImg) return urlImg[0];

    // Priority 2: Telegram Media (Placeholder since we can't easily get direct URL for raw media in browser)
    return "https://via.placeholder.com/160x230/111/f5c518?text=TV";
}

function extraerSinopsis(msg) {
    const partes = msg.split('\n');
    return partes.length > 1 ? partes.slice(1).join(' ').substring(0, 300) : "Contenido exclusivo de @gran_player.";
}

function itemExiste(cat, titulo) {
    return base[cat] && base[cat].some(i => i.titulo.toUpperCase() === titulo.toUpperCase());
}

/**
 * Video Player Engine: High Compatibility
 */
window.mostrarCaps = function(items, esSerie) {
    const box = document.getElementById('linksBox');
    if (!box) return;

    box.innerHTML = '';
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = "link-item";
        div.style = "background:var(--surface); padding:16px; border-radius:10px; margin-bottom:10px; cursor:pointer; display:flex; align-items:center; gap:15px; border:1px solid var(--border);";
        div.innerHTML = `
            <i class="fa fa-play-circle" style="color:var(--gold); font-size:22px;"></i>
            <div style="flex:1;">
                <b style="color:#fff; font-size:14px;">${item.titulo}</b>
            </div>
            <i class="fa fa-chevron-right" style="color:#444;"></i>
        `;
        div.onclick = () => reproducirVideoInterno(item.titulo, item.link);
        box.appendChild(div);
    });
};

async function reproducirVideoInterno(titulo, url) {
    const playerLayer = document.getElementById('player-layer');
    const video = document.getElementById('main-video');
    const info = document.getElementById('video-info');

    if (!playerLayer || !video) return;

    playerLayer.style.display = 'flex';
    info.innerText = titulo;
    video.src = ""; // Stop previous

    try {
        if (url.includes('t.me/')) {
            // Resolve Telegram mp4 direct link
            const sUrl = url.replace("t.me/", "t.me/s/");
            const proxy = 'https://api.allorigins.win/get?url=';

            const res = await fetch(proxy + encodeURIComponent(sUrl));
            if (!res.ok) throw new Error("Proxy error");

            const data = await res.json();
            const html = data.contents;

            // Advanced parsing for video source
            const videoUrl = html.match(/<video[^>]*src="([^"]*)"/)?.[1] ||
                             html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]*)"/)?.[1];

            if (videoUrl) {
                video.src = videoUrl;
                video.load();
                video.play();
            } else {
                throw new Error("No video found in preview");
            }
        } else {
            video.src = url;
            video.play();
        }
    } catch (e) {
        console.warn("🛡️ Internal player failed, using fallback:", e);
        // Fallback: If in Telegram WebApp, use its openLink, otherwise window.open
        if (window.Telegram?.WebApp) {
            window.Telegram.WebApp.openLink(url);
        } else {
            window.open(url, '_blank');
        }
        playerLayer.style.display = 'none';
    }
}

// Master Boot
window.addEventListener('load', () => {
    // Ensure styles are set
    document.documentElement.style.setProperty('--gold', '#f5c518');
    setTimeout(initGramJS, 800);
});
