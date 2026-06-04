// Configuración del Cliente
const apiId = 8952741;
const apiHash = "693fb2da124662dad85b2b337c53a386";

let client = null;
let loginResolver = null;
let step = 'phone';

async function initGramJS() {
    const { TelegramClient, Api } = window.telegram;
    const { StringSession } = window.telegram.sessions;

    const stringSession = new StringSession(localStorage.getItem('tg_session') || "");

    client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: true
    });

    console.log("Cliente GramJS configurado");
    conectarTelegram();
}

async function conectarTelegram() {
    console.log("Conectando...");
    try {
        await client.connect();

        const isAuth = await client.checkAuthorization();
        if (!isAuth) {
            console.log("Mostrando modal de login");
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

        console.log("¡Sesión iniciada!");
        inicializarContenidoTelegram();

    } catch (e) {
        console.error("Error en conexión:", e);
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
    if (step === 'code') msg.innerText = "Introduce el código de Telegram";
    if (step === '2fa') msg.innerText = "Introduce tu contraseña 2FA";
}

function iniciarLogin() {
    const val = step === 'phone' ? document.getElementById('phone-input').value :
                step === 'code' ? document.getElementById('code-input').value :
                document.getElementById('2fa-input').value;
    if (loginResolver) loginResolver(val);
}

async function inicializarContenidoTelegram() {
    const channelId = "gran_player";
    try {
        const entity = await client.getEntity(channelId);
        const fullChannel = await client.invoke(new window.telegram.Api.channels.GetFullChannel({ channel: entity }));
        const topics = fullChannel.fullChat.topics.topics || [];

        console.log("Cargando contenido de topics...");
        for (const topic of topics) {
            await cargarMensajesDeTopic(entity, topic);
        }

        if (typeof render === 'function') render(filtroActual);
    } catch (e) {
        console.error("Error al cargar contenido:", e);
    }
}

async function cargarMensajesDeTopic(entity, topic) {
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

        const titulo = m.message.split('\n')[0].replace(/#\w+/g, '').trim();
        const link = extraerEnlace(m.message);

        if (link && !itemExiste(cat, titulo)) {
            base[cat].push({
                titulo: titulo,
                link: link,
                portada: extraerPortada(m),
                sinopsis: extraerSinopsis(m.message),
                catAsignada: cat,
                id: m.id.toString()
            });
        }
    });
}

function extraerEnlace(msg) {
    const ace = msg.match(/[a-f0-9]{40}/);
    if (ace) return "acestream://" + ace[0];
    const url = msg.match(/https?:\/\/[^\s]+/);
    return url ? url[0] : null;
}

function extraerPortada(m) {
    const urlImg = m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i);
    return urlImg ? urlImg[0] : "https://via.placeholder.com/145x190/000/f5c518?text=VIDEO";
}

function extraerSinopsis(msg) {
    const partes = msg.split('\n');
    return partes.length > 1 ? partes.slice(1).join(' ') : "Contenido de Telegram.";
}

function itemExiste(cat, titulo) {
    return base[cat].some(i => i.titulo.toUpperCase() === titulo.toUpperCase());
}

// Interceptar reproductor
window.mostrarCaps = function(items, esSerie) {
    const box = document.getElementById('linksBox');
    box.innerHTML = '';
    items.forEach(item => {
        const row = document.createElement('div');
        row.className = "link-row"; // Usar clases si existen o estilo directo
        row.style = "background:rgba(255,255,255,0.05); margin-bottom:8px; padding:12px; border-radius:10px; cursor:pointer; display:flex; align-items:center; gap:12px; border:1px solid rgba(255,255,255,0.1);";
        row.innerHTML = `<i class="fa fa-play" style="color:gold;"></i><div style="color:white; flex:1;"><b>${item.titulo}</b></div>`;
        row.onclick = () => reproducirVideoInterno(item.titulo, item.link);
        box.appendChild(row);
    });
};

async function reproducirVideoInterno(titulo, url) {
    const playerLayer = document.getElementById('player-layer');
    const video = document.getElementById('main-video');
    const info = document.getElementById('video-info');
    playerLayer.style.display = 'flex';
    info.innerText = titulo;

    try {
        if (url.includes('t.me/')) {
            const sUrl = url.replace("t.me/", "t.me/s/");
            const res = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(sUrl));
            const data = await res.json();
            const html = data.contents;
            const videoMatch = html.match(/<video[^>]*src="([^"]*)"/);
            const metaMatch = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]*)"/);
            const resolvedUrl = videoMatch ? videoMatch[1] : (metaMatch ? metaMatch[1] : null);

            if (resolvedUrl) {
                video.src = resolvedUrl;
                video.play();
            } else {
                window.open(url, '_blank');
                playerLayer.style.display = 'none';
            }
        } else {
            video.src = url;
            video.play();
        }
    } catch (e) {
        console.error(e);
        window.open(url, '_blank');
        playerLayer.style.display = 'none';
    }
}

// Iniciar cuando GramJS esté listo
window.addEventListener('load', () => {
    // Esperar un momento para asegurar que el script de Telegram se cargó
    setTimeout(initGramJS, 1000);
});
