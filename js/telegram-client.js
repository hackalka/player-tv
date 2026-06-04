/**
 * LÓGICA DE TELEGRAM - VERSIÓN LIMPIA Y ROBUSTA
 */
const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let tgClient = null;
let tgLoginResolve = null;
let currentStep = 'phone';

async function iniciarAppTelegram() {
    console.log("🛠 Iniciando motor de Telegram...");

    // Verificamos librerías cargadas
    if (!window.telegram || !window.Buffer) {
        console.warn("⏳ Librerías no listas, reintentando...");
        setTimeout(iniciarAppTelegram, 500);
        return;
    }

    const { TelegramClient, Api } = window.telegram;
    const { StringSession } = window.telegram.sessions;

    const session = new StringSession(localStorage.getItem('tg_session') || "");
    tgClient = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true
    });

    try {
        await tgClient.connect();

        if (!await tgClient.checkAuthorization()) {
            console.log("🔐 Requiere autenticación");
            document.getElementById('login-modal').style.display = 'flex';

            await tgClient.start({
                phoneNumber: async () => {
                    currentStep = 'phone';
                    return new Promise(res => tgLoginResolve = res);
                },
                phoneCode: async () => {
                    currentStep = 'code';
                    actualizarModalUI();
                    return new Promise(res => tgLoginResolve = res);
                },
                password: async () => {
                    currentStep = '2fa';
                    actualizarModalUI();
                    return new Promise(res => tgLoginResolve = res);
                },
                onError: (err) => alert("Error: " + err.message)
            });

            localStorage.setItem('tg_session', tgClient.session.save());
            document.getElementById('login-modal').style.display = 'none';
        }

        console.log("✅ Telegram conectado y autorizado");
        sincronizarContenido();

    } catch (e) {
        console.error("❌ Fallo crítico en Telegram:", e);
    }
}

function actualizarModalUI() {
    const msg = document.getElementById('login-msg');
    document.getElementById('phone-input').style.display = currentStep === 'phone' ? 'block' : 'none';
    document.getElementById('code-input').style.display = currentStep === 'code' ? 'block' : 'none';
    document.getElementById('2fa-input').style.display = currentStep === '2fa' ? 'block' : 'none';

    if (currentStep === 'code') msg.innerText = "Introduce el código que has recibido en Telegram";
    if (currentStep === '2fa') msg.innerText = "Introduce tu contraseña de Verificación en 2 pasos";
}

function iniciarLogin() {
    const input = currentStep === 'phone' ? document.getElementById('phone-input') :
                  currentStep === 'code' ? document.getElementById('code-input') :
                  document.getElementById('2fa-input');

    if (tgLoginResolve && input.value) {
        tgLoginResolve(input.value);
    }
}

async function sincronizarContenido() {
    console.log("📥 Sincronizando contenido desde @gran_player...");
    try {
        const entity = await tgClient.getEntity("gran_player");
        const { Api } = window.telegram;
        const full = await tgClient.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        const topics = full.fullChat.topics.topics || [];

        for (const topic of topics) {
            const messages = await tgClient.getMessages(entity, { replyTo: topic.id, limit: 30 });

            messages.forEach(m => {
                if (!m.message) return;
                procesarMensaje(m);
            });
        }

        if (typeof render === 'function') render(filtroActual);
    } catch (e) {
        console.error("❌ Error al sincronizar:", e);
    }
}

function procesarMensaje(m) {
    const texto = m.message.toLowerCase();
    let cat = "inicio";
    if (texto.includes("#pelicula")) cat = "peliculas";
    else if (texto.includes("#serie")) cat = "series";
    else if (texto.includes("#directo")) cat = "directos";
    else if (texto.includes("#agenda")) cat = "agenda";

    const titulo = m.message.split('\n')[0].replace(/#\w+/g, '').trim();
    const link = extraerEnlace(m.message);

    if (link && !itemExisteEnBase(cat, titulo)) {
        base[cat].push({
            titulo: titulo,
            link: link,
            portada: extraerPortada(m.message),
            sinopsis: m.message,
            catAsignada: cat
        });
    }
}

function extraerEnlace(msg) {
    const ace = msg.match(/[a-f0-9]{40}/);
    if (ace) return "acestream://" + ace[0];
    const url = msg.match(/https?:\/\/[^\s]+/);
    return url ? url[0] : null;
}

function extraerPortada(msg) {
    const url = msg.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i);
    return url ? url[0] : "https://via.placeholder.com/160x230/111/f5c518?text=VIDEO";
}

function itemExisteEnBase(cat, titulo) {
    return base[cat].some(i => i.titulo.toUpperCase() === titulo.toUpperCase());
}

// Iniciar proceso cuando todo cargue
window.addEventListener('load', () => {
    setTimeout(iniciarAppTelegram, 1000);
});
