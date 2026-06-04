/**
 * MOTOR DE TELEGRAM (RECONSTRUCCIÓN MAESTRA)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let client = null;

async function startEngine() {
    console.log("🚀 Arrancando motor...");

    // AUTO-REPARACIÓN DE BUFFER
    if (typeof window.Buffer === 'undefined' && window.buffer) {
        window.Buffer = window.buffer.Buffer;
    }

    const lib = window.telegram;

    if (!lib || !window.Buffer) {
        console.error("❌ Librería no detectada. Esperando...");
        document.getElementById('boot-status').innerText = "ESPERANDO LIBRERÍAS...";
        setTimeout(startEngine, 1000);
        return;
    }

    const { TelegramClient, sessions } = lib;
    const session = new sessions.StringSession(localStorage.getItem('tg_session') || "");

    client = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true
    });

    try {
        document.getElementById('boot-status').innerText = "CONECTANDO...";
        await client.connect();

        if (!await client.checkAuthorization()) {
            document.getElementById('loader-screen').style.display = 'none';
            document.getElementById('login-modal').style.display = 'flex';
            runQRFlow();
        } else {
            onAuthorized();
        }
    } catch (e) {
        console.error(e);
        document.getElementById('boot-status').innerHTML = "<span style='color:red;'>ERROR DE CONEXIÓN</span>";
    }
}

async function runQRFlow() {
    try {
        await client.signInUserWithQrCode({ apiId: API_ID, apiHash: API_HASH }, {
            qrCode: async (code) => {
                const url = `tg://login?token=${code.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
                if (window.qrcode) {
                    const qr = qrcode(0, 'M');
                    qr.addData(url);
                    qr.make();
                    document.getElementById('qr-loading').style.display = 'none';
                    document.getElementById('qr-code').innerHTML = qr.createSvgTag({ cellSize: 4 });
                }
            }
        });
        onAuthorized();
    } catch (e) {}
}

function onAuthorized() {
    localStorage.setItem('tg_session', client.session.save());
    document.getElementById('loader-screen').style.display = 'none';
    document.getElementById('login-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
    sync();
}

async function sync() {
    try {
        const { Api } = window.telegram;
        const chatId = "gran_player";
        const channel = await client.getEntity(chatId);
        const full = await client.invoke(new Api.channels.GetFullChannel({ channel }));
        const topics = full.fullChat.topics.topics || [];

        for (const t of topics) {
            const msgs = await client.getMessages(channel, { replyTo: t.id, limit: 30 });
            msgs.forEach(m => {
                if (!m.message) return;
                const txt = m.message.toLowerCase();
                let cat = "inicio";
                if (txt.includes("#pelicula")) cat = "peliculas";
                else if (txt.includes("#serie")) cat = "series";

                const tit = m.message.split('\n')[0].replace(/#\w+/g, '').trim();
                const lnk = m.message.match(/https?:\/\/[^\s]+/)?.[0];

                if (lnk && !base[cat].some(i => i.titulo === tit)) {
                    base[cat].push({
                        titulo: tit, link: lnk,
                        chatId: chatId, msgId: m.id,
                        portada: m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i)?.[0] || "https://via.placeholder.com/160x230/111/f5c518?text=TV",
                        sinopsis: m.message, catAsignada: cat
                    });
                }
            });
        }
        if (typeof render === 'function') render('inicio');
    } catch (e) { console.error("Error sincronizando:", e); }
}

window.addEventListener('load', startEngine);
