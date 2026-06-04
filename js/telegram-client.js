// Configuración del Cliente - Fix de Inicialización
const apiId = 8952741;
const apiHash = "693fb2da124662dad85b2b337c53a386";

let client = null;
let loginResolver = null;
let step = 'phone';
let isLoadingTelegram = false;

async function initGramJS() {
    // Verificamos que la librería esté cargada en window.telegram
    if (!window.telegram) {
        console.error("❌ Librería GramJS no detectada. Reintentando...");
        setTimeout(initGramJS, 1000);
        return;
    }

    const { TelegramClient, Api } = window.telegram;
    const { StringSession } = window.telegram.sessions;

    const stringSession = new StringSession(localStorage.getItem('tg_session') || "");

    client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: true
    });

    console.log("🚀 Cliente GramJS Inicializado");
    conectarTelegram();
}

async function conectarTelegram() {
    try {
        await client.connect();
        const isAuth = await client.checkAuthorization();

        if (!isAuth) {
            document.getElementById('login-modal').style.display = 'flex';
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
                    alert("Error: " + err.message);
                    location.reload();
                },
            });
            localStorage.setItem('tg_session', client.session.save());
            document.getElementById('login-modal').style.display = 'none';
        }

        console.log("✅ Sesión Telegram Activa");
        inicializarContenidoTelegram();

    } catch (e) {
        console.error("❌ Error en conexión:", e);
        if (e.message.includes("AUTH_KEY_UNREGISTERED")) {
            localStorage.removeItem('tg_session');
            location.reload();
        }
    }
}

function actualizarUI() {
    document.getElementById('phone-input').style.display = step === 'phone' ? 'block' : 'none';
    document.getElementById('code-input').style.display = step === 'code' ? 'block' : 'none';
    document.getElementById('2fa-input').style.display = step === '2fa' ? 'block' : 'none';

    const msg = document.getElementById('login-msg');
    if (step === 'code') msg.innerHTML = "Código enviado. <br> Revisa tus mensajes de Telegram.";
    if (step === '2fa') msg.innerHTML = "Introduce tu contraseña de <br> Verificación en dos pasos.";
}

function iniciarLogin() {
    const val = step === 'phone' ? document.getElementById('phone-input').value :
                step === 'code' ? document.getElementById('code-input').value :
                document.getElementById('2fa-input').value;
    if (loginResolver) loginResolver(val);
}

async function inicializarContenidoTelegram() {
    if (isLoadingTelegram) return;
    isLoadingTelegram = true;

    const channelId = "gran_player";
    try {
        const entity = await client.getEntity(channelId);
        // Usar window.telegram.Api para asegurar acceso global
        const fullChannel = await client.invoke(new window.telegram.Api.channels.GetFullChannel({ channel: entity }));
        const topics = fullChannel.fullChat.topics.topics || [];

        console.log("📂 Cargando " + topics.length + " Topics...");

        const promises = topics.map(topic => cargarMensajesDeTopic(entity, topic));
        await Promise.all(promises);

        console.log("✨ Todo el contenido cargado");
        if (typeof render === 'function') render(filtroActual);
    } catch (e) {
        console.error("❌ Error al cargar contenido:", e);
    } finally {
        isLoadingTelegram = false;
    }
}

async function cargarMensajesDeTopic(entity, topic) {
    const messages = await client.getMessages(entity, {
        replyTo: topic.id,
        limit: 40
    });

    messages.forEach(m => {
        if (!m.message) return;
        const texto = m.message.toLowerCase();
        let cat = "inicio";

        if (texto.includes("#pelicula")) cat = "peliculas";
        else if (texto.includes("#serie")) cat = "series";
        else if (texto.includes("#directo")) cat = "directos";
        else if (texto.includes("#agenda")) cat = "agenda";

        const titulo = m.message.split('\n')[0].replace(/#\w+/g, '').trim();
        const link = extraerEnlace(m.message);

        if (link && !itemExiste(cat, titulo)) {
            const item = {
                titulo: titulo,
                link: link,
                portada: extraerPortada(m),
                sinopsis: extraerSinopsis(m.message),
                catAsignada: cat,
                id: m.id.toString(),
                extra: cat === 'agenda' ? extraerExtraAgenda(m.message) : ""
            };
            base[cat].push(item);
        }
    });
}

function extraerEnlace(msg) {
    const ace = msg.match(/[a-f0-9]{40}/);
    if (ace) return "acestream://" + ace[0];
    const url = msg.match(/https?:\/\/[^\s]+/);
    return url ? url[0] : null;
}

function extraerExtraAgenda(msg) {
    const match = msg.match(/\d{2}:\d{2}/);
    return match ? "HOY " + match[0] : "";
}

function extraerPortada(m) {
    const urlImg = m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i);
    return urlImg ? urlImg[0] : "https://via.placeholder.com/160x230/111/f5c518?text=VIDEO";
}

function extraerSinopsis(msg) {
    const partes = msg.split('\n');
    return partes.length > 1 ? partes.slice(1).join(' ').substring(0, 200) + "..." : "Disfruta de este contenido directamente desde Telegram.";
}

function itemExiste(cat, titulo) {
    return base[cat].some(i => i.titulo.toUpperCase() === titulo.toUpperCase());
}

window.mostrarCaps = function(items, esSerie) {
    const box = document.getElementById('linksBox');
    box.innerHTML = '';

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = "link-item";
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:15px;">
                <i class="fa fa-play-circle" style="color:var(--gold); font-size:20px;"></i>
                <b style="color:#fff;">${item.titulo}</b>
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

    playerLayer.style.display = 'flex';
    info.innerText = titulo;
    video.innerHTML = '';

    try {
        if (url.includes('t.me/')) {
            const sUrl = url.replace("t.me/", "t.me/s/");
            const proxy = 'https://api.allorigins.win/get?url=';
            const res = await fetch(proxy + encodeURIComponent(sUrl));
            const data = await res.json();
            const html = data.contents;

            const videoUrl = html.match(/<video[^>]*src="([^"]*)"/)?.[1] ||
                             html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]*)"/)?.[1];

            if (videoUrl) {
                video.src = videoUrl;
                video.play();
            } else {
                throw new Error("No video found");
            }
        } else {
            video.src = url;
            video.play();
        }
    } catch (e) {
        console.warn("⚠️ Fallo reproductor interno:", e);
        if (window.Telegram?.WebApp) window.Telegram.WebApp.openLink(url);
        else window.open(url, '_blank');
        playerLayer.style.display = 'none';
    }
}

// Inicialización Robusta
window.addEventListener('load', () => {
    setTimeout(initGramJS, 1000);
});
