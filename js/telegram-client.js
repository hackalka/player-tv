/**
 * TELEGRAM STREAMING ENGINE (MASTER EDITION)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let tgClient = null;
let loginRes = null;
let step = 'phone';
let swRegistration = null;

// Registro del Service Worker para Streaming
async function registerSW() {
    if ('serviceWorker' in navigator) {
        try {
            swRegistration = await navigator.serviceWorker.register('sw.js');
            console.log("✅ Service Worker de Streaming registrado");

            // Establecer canal de comunicación
            navigator.serviceWorker.ready.then((registration) => {
                const messageChannel = new MessageChannel();
                messageChannel.port1.onmessage = handleSWMessage;
                registration.active.postMessage({ type: 'INIT' }, [messageChannel.port2]);
            });
        } catch (e) {
            console.error("Fallo al registrar SW:", e);
        }
    }
}

async function handleSWMessage(e) {
    const { type, requestId, streamId, start, size } = e.data;
    if (type === 'FETCH_RANGE') {
        try {
            // Esta es la magia: descargamos el trozo de Telegram directamente
            const chunk = await downloadTelegramChunk(streamId, start, size);
            e.target.postMessage({ requestId, chunk });
        } catch (err) {
            e.target.postMessage({ requestId, error: err.message });
        }
    }
}

async function downloadTelegramChunk(streamId, start, size) {
    // Obtenemos el mensaje que contiene el archivo
    // streamId tendrá el formato "chatId-msgId"
    const [chatId, msgId] = streamId.split('-');
    const messages = await tgClient.getMessages(chatId, { ids: [parseInt(msgId)] });
    if (!messages.length || !messages[0].media) throw new Error("Archivo no encontrado");

    const media = messages[0].media;
    // Descargar el trozo específico
    const buffer = await tgClient.downloadMedia(media, {
        start: BigInt(start),
        end: BigInt(start + size - 1),
        workers: 1
    });
    return buffer; // ArrayBuffer
}

async function startEngine() {
    if (!window.telegram || !window.Buffer) {
        setTimeout(startEngine, 500);
        return;
    }

    await registerSW();

    const { TelegramClient, sessions } = window.telegram;
    const session = new sessions.StringSession(localStorage.getItem('tg_session') || "");

    tgClient = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true
    });

    try {
        await tgClient.connect();
        if (!await tgClient.checkAuthorization()) {
            document.getElementById('login-modal').style.display = 'flex';
            await tgClient.start({
                phoneNumber: async () => { step='phone'; updateLoginUI(); return new Promise(r => loginRes=r); },
                phoneCode: async () => { step='code'; updateLoginUI(); return new Promise(r => loginRes=r); },
                password: async () => { step='2fa'; updateLoginUI(); return new Promise(r => loginRes=r); },
                onError: (err) => alert("Error: " + err.message)
            });
            localStorage.setItem('tg_session', tgClient.session.save());
            document.getElementById('login-modal').style.display = 'none';
        }
        loadTelegramContent();
    } catch (e) {
        console.error(e);
    }
}

// Interceptar clics en portadas para usar el Streaming
window.playVideo = async function(titulo, item) {
    const player = document.getElementById('player-layer');
    const video = document.getElementById('main-video');
    const info = document.getElementById('video-info');

    player.style.display = 'flex';
    info.innerText = titulo;

    if (item.msgId && item.chatId) {
        // Obtenemos info del archivo para registrarlo en el Service Worker
        const messages = await tgClient.getMessages(item.chatId, { ids: [parseInt(item.msgId)] });
        const media = messages[0]?.media;
        const fileSize = media?.document?.size || media?.video?.size;
        const mimeType = media?.document?.mimeType || media?.video?.mimeType || 'video/mp4';

        if (fileSize) {
            const streamId = `${item.chatId}-${item.msgId}`;
            // Registramos el stream en el worker
            navigator.serviceWorker.controller.postMessage({
                type: 'REGISTER',
                streamId,
                fileSize: Number(fileSize),
                mimeType
            });

            // La URL ahora es local, servida por nuestro Service Worker
            video.src = `/tg-stream/${streamId}`;
            video.play().catch(e => console.error("Error al reproducir streaming:", e));
            return;
        }
    }

    // Fallback si no es un archivo directo de Telegram
    video.src = item.link;
    video.play();
};

// ... resto de funciones de login y carga ...
function updateLoginUI() {
    document.getElementById('phone-input').style.display = step==='phone'?'block':'none';
    document.getElementById('code-input').style.display = step==='code'?'block':'none';
    document.getElementById('2fa-input').style.display = step==='2fa'?'block':'none';
    document.getElementById('login-msg').innerText = step==='code'?'Introduce el código':'Introduce el 2FA';
}

function iniciarLogin() {
    const v = step==='phone' ? document.getElementById('phone-input').value :
              step==='code' ? document.getElementById('code-input').value :
              document.getElementById('2fa-input').value;
    if (loginRes && v) loginRes(v);
}

async function loadTelegramContent() {
    try {
        const { Api } = window.telegram;
        const chatId = "gran_player";
        const entity = await tgClient.getEntity(chatId);
        const full = await tgClient.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        const topics = full.fullChat.topics.topics || [];

        for (const t of topics) {
            const msgs = await tgClient.getMessages(entity, { replyTo: t.id, limit: 40 });
            msgs.forEach(m => {
                if (!m.message) return;
                const txt = m.message.toLowerCase();
                let cat = "inicio";
                if (txt.includes("#pelicula")) cat = "peliculas";
                else if (txt.includes("#serie")) cat = "series";
                else if (txt.includes("#directo")) cat = "directos";
                else if (txt.includes("#agenda")) cat = "agenda";

                const titulo = m.message.split('\n')[0].replace(/#\w+/g, '').trim();
                const link = m.message.match(/https?:\/\/[^\s]+/)?.[0];

                if (!base[cat].some(i => i.titulo === titulo)) {
                    base[cat].push({
                        titulo, link,
                        chatId: chatId,
                        msgId: m.id,
                        portada: m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i)?.[0] || "https://via.placeholder.com/160x230/111/f5c518?text=PREVIEW",
                        sinopsis: m.message,
                        catAsignada: cat
                    });
                }
            });
        }
        if (typeof render === 'function') render(filtroActual);
    } catch (e) { console.error(e); }
}

window.addEventListener('load', startEngine);
