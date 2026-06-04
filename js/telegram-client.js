/**
 * TELEGRAM ENGINE (CINEFLIX ARCHITECTURE)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let tgClient = null;
let loginResolver = null;

function setStatus(txt) {
    const el = document.getElementById('boot-status');
    if (el) el.innerText = txt.toUpperCase();
}

async function startBootSequence() {
    console.log("🛠 Iniciando secuencia de arranque...");

    // Verificación de salud del entorno
    if (!window.telegram || (!window.Buffer && !window.buffer)) {
        setStatus("Esperando librerías...");
        setTimeout(startBootSequence, 500);
        return;
    }

    // Inyección de emergencia de Buffer
    if (!window.Buffer && window.buffer) window.Buffer = window.buffer.Buffer;

    const { TelegramClient, Api } = window.telegram;
    const { StringSession } = window.telegram.sessions;

    const session = new StringSession(localStorage.getItem('tg_session') || "");
    tgClient = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true
    });

    try {
        setStatus("Conectando con servidores...");
        await tgClient.connect();

        if (!await tgClient.checkAuthorization()) {
            console.log("🔐 Autenticación necesaria");
            document.getElementById('cineflix-intro').style.display = 'none';
            document.getElementById('view-login').style.display = 'block';
            iniciarFlujoQR();
        } else {
            setStatus("Acceso concedido");
            finalizarCarga();
        }
    } catch (e) {
        console.error(e);
        setStatus("Error de red. Reintentando...");
    }
}

async function iniciarFlujoQR() {
    try {
        await tgClient.signInUserWithQrCode({ apiId: API_ID, apiHash: API_HASH }, {
            onError: (err) => {
                if (err.message.includes("SESSION_PASSWORD_NEEDED")) {
                    document.getElementById('step-phone').style.display = 'none';
                    document.getElementById('step-2fa').style.display = 'block';
                }
            },
            qrCode: async (code) => {
                const url = `tg://login?token=${code.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
                dibujarQR(url);
            }
        });
        finalizarCarga();
    } catch (e) { console.log("QR Flow reset"); }
}

function dibujarQR(url) {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    document.getElementById('qr-loading').style.display = 'none';
    document.getElementById('qr-code').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 0 });
}

function finalizarCarga() {
    localStorage.setItem('tg_session', tgClient.session.save());
    document.getElementById('cineflix-intro').style.display = 'none';
    document.getElementById('view-login').style.display = 'none';
    document.getElementById('view-catalog').style.display = 'block';
    document.body.style.overflow = 'auto';
    sincronizarTelegram();
}

async function sincronizarTelegram() {
    try {
        const { Api } = window.telegram;
        const channel = await tgClient.getEntity("gran_player");
        const full = await tgClient.invoke(new Api.channels.GetFullChannel({ channel }));
        const topics = full.fullChat.topics.topics || [];

        for (const t of topics) {
            const msgs = await tgClient.getMessages(channel, { replyTo: t.id, limit: 40 });
            msgs.forEach(m => {
                if (!m.message) return;
                procesarMensaje(m);
            });
        }
        if (typeof render === 'function') render('inicio');
    } catch (e) { console.error("Error sync:", e); }
}

function procesarMensaje(m) {
    const txt = m.message.toLowerCase();
    let cat = "inicio";
    if (txt.includes("#pelicula")) cat = "peliculas";
    else if (txt.includes("#serie")) cat = "series";

    const titulo = m.message.split('\n')[0].replace(/#\w+/g, '').trim();
    const link = m.message.match(/https?:\/\/[^\s]+/)?.[0];

    if (link && !base[cat].some(i => i.titulo === titulo)) {
        base[cat].push({
            titulo, link,
            portada: m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i)?.[0] || "https://via.placeholder.com/160x230/111/f5c518?text=PREVIEW",
            sinopsis: m.message,
            catAsignada: cat,
            msgId: m.id,
            chatId: "gran_player"
        });
    }
}

window.addEventListener('load', () => setTimeout(startBootSequence, 1000));
