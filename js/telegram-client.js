const { TelegramClient, Api } = window.telegram;
const { StringSession } = window.telegram.sessions;

const apiId = 8952741;
const apiHash = "693fb2da124662dad85b2b337c53a386";
const stringSession = new StringSession(localStorage.getItem('tg_session') || "");

const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: true
});

let loginResolver;
let step = 'phone';

async function conectarTelegram() {
    if (!localStorage.getItem('tg_session')) {
        document.getElementById('login-modal').style.display = 'flex';
        try {
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
                onError: (err) => alert("Error: " + err.message),
            });
            localStorage.setItem('tg_session', client.session.save());
            document.getElementById('login-modal').style.display = 'none';
            await inicializarContenidoTelegram();
        } catch (e) {
            console.error(e);
        }
    } else {
        await client.connect();
        await inicializarContenidoTelegram();
    }
}

function actualizarUI() {
    if (step === 'code') {
        document.getElementById('phone-input').style.display = 'none';
        document.getElementById('code-input').style.display = 'block';
        document.getElementById('login-msg').innerText = "Introduce el código recibido";
    } else if (step === '2fa') {
        document.getElementById('code-input').style.display = 'none';
        document.getElementById('2fa-input').style.display = 'block';
        document.getElementById('login-msg').innerText = "Introduce tu contraseña 2FA";
    }
}

function iniciarLogin() {
    const val = step === 'phone' ? document.getElementById('phone-input').value :
                step === 'code' ? document.getElementById('code-input').value :
                document.getElementById('2fa-input').value;
    if (loginResolver) loginResolver(val);
}

// Mapeo de Topics a Categorías de tu web
async function inicializarContenidoTelegram() {
    const channelId = "gran_player";
    try {
        const entity = await client.getEntity(channelId);
        const fullChannel = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        const topics = fullChannel.fullChat.topics.topics || [];

        // Mapeamos los topics a las categorías globales de main.js
        // Cada topic será tratado como una categoría de contenido
        for (const topic of topics) {
            await cargarMensajesDeTopic(entity, topic);
        }

        if (typeof render === 'function') render(filtroActual);
    } catch (e) {
        console.error("Error al cargar contenido de Telegram:", e);
    }
}

async function cargarMensajesDeTopic(entity, topic) {
    // Obtenemos los mensajes del hilo (topic)
    const messages = await client.getMessages(entity, {
        replyTo: topic.id,
        limit: 100
    });

    messages.forEach(m => {
        if (!m.message) return;

        const texto = m.message.toLowerCase();
        let cat = "inicio";
        if (texto.includes("#pelicula")) cat = "peliculas";
        else if (texto.includes("#serie")) cat = "series";
        else if (texto.includes("#directo")) cat = "directos";
        else if (texto.includes("#agenda")) cat = "agenda";

        // Extraer enlaces y datos para que se vea como en tu web original
        const titulo = m.message.split('\n')[0].replace(/#\w+/g, '').trim();
        const link = extraerEnlace(m.message);

        if (link && !itemExiste(cat, titulo)) {
            const nuevoItem = {
                titulo: titulo,
                link: link,
                portada: extraerPortada(m),
                sinopsis: extraerSinopsis(m.message),
                catAsignada: cat,
                id: m.id.toString()
            };
            base[cat].push(nuevoItem);
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
    // Si el mensaje tiene una foto, podríamos usarla, por ahora placeholder o buscar en texto
    const urlImg = m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i);
    return urlImg ? urlImg[0] : "https://via.placeholder.com/145x190/000/f5c518?text=TV";
}

function extraerSinopsis(msg) {
    const partes = msg.split('\n');
    return partes.length > 1 ? partes.slice(1).join(' ') : "Sin descripción.";
}

function itemExiste(cat, titulo) {
    return base[cat].some(i => i.titulo.toUpperCase() === titulo.toUpperCase());
}

// Sobrescribir el abrir reproductor de tu web para que use nuestro Player interno
// y NO abra la app de Telegram
const originalCerrarModal = window.cerrarModal;
const originalMostrarCaps = window.mostrarCaps;

window.mostrarCaps = function(items, esSerie) {
    // Reemplazamos la lógica de mostrar enlaces para que use nuestro player
    const box = document.getElementById('linksBox');
    box.innerHTML = '';

    items.forEach(item => {
        const row = document.createElement('div');
        row.style = "background:rgba(255,255,255,0.05); margin-bottom:8px; padding:12px; border-radius:10px; cursor:pointer; display:flex; align-items:center; gap:12px; border:1px solid rgba(255,255,255,0.1);";
        row.innerHTML = `<i class="fa fa-play" style="color:gold;"></i><div style="color:white; flex:1;"><b>${item.titulo}</b></div>`;

        row.onclick = () => {
            if (item.link.includes('t.me/')) {
                // Si es link de telegram, lo resolvemos internamente con nuestro player
                reproducirVideoInterno(item.titulo, item.link);
            } else {
                // Si es otro link, dejamos que siga la lógica original de tu web
                if (tg) tg.openLink(item.link); else window.location.href = item.link;
            }
        };
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
        // Resolver URL de Telegram en JS
        const sUrl = url.replace("t.me/", "t.me/s/");
        const response = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(sUrl));
        const data = await response.json();
        const html = data.contents;

        // Buscar video en el HTML
        const videoMatch = html.match(/<video[^>]*src="([^"]*)"/);
        const metaMatch = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]*)"/);

        const resolvedUrl = videoMatch ? videoMatch[1] : (metaMatch ? metaMatch[1] : null);

        if (resolvedUrl) {
            video.src = resolvedUrl;
            video.play();
        } else {
            console.log("No se pudo obtener el video directo, abriendo externamente...");
            if (window.Telegram?.WebApp) window.Telegram.WebApp.openLink(url);
            else window.open(url, '_blank');
            playerLayer.style.display = 'none';
        }
    } catch (e) {
        console.error("Error al resolver video:", e);
        playerLayer.style.display = 'none';
    }
}

window.onload = () => {
    conectarTelegram();
    if (typeof cargar === 'function') cargar();
};
