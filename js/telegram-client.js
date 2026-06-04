/**
 * TELEGRAM ENGINE (QR EDITION)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let client = null;
let loginRes = null;
let step = 'qr';

function setStatus(txt) {
    const el = document.getElementById('boot-status');
    if (el) el.innerText = txt;
}

async function bootApp() {
    if (!window.telegram || !window.Buffer || !window.qrcode) {
        setTimeout(bootApp, 500);
        return;
    }

    const { TelegramClient, Api } = window.telegram;
    const { StringSession } = window.telegram.sessions;

    const session = new StringSession(localStorage.getItem('tg_session') || "");
    client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5, useWSS: true });

    try {
        setStatus("Conectando con servidores...");
        await client.connect();

        if (!await client.checkAuthorization()) {
            document.getElementById('intro-screen').style.display = 'none';
            document.getElementById('login-modal').style.display = 'flex';
            handleQRLogin();
        } else {
            finalizeLogin();
        }
    } catch (e) {
        console.error(e);
        setStatus("Error de conexión. Reintentando...");
    }
}

async function handleQRLogin() {
    const { Api } = window.telegram;

    // Iniciar flujo de QR
    try {
        const qrResult = await client.signInUserWithQrCode({
            apiId: API_ID,
            apiHash: API_HASH,
        }, {
            onError: (err) => {
                if (err.message.includes("SESSION_PASSWORD_NEEDED")) {
                    step = '2fa';
                    updateUI();
                } else {
                    alert("Error: " + err.message);
                }
            },
            qrCode: async (code) => {
                const url = `tg://login?token=${code.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
                generateQRCode(url);
            }
        });

        localStorage.setItem('tg_session', client.session.save());
        finalizeLogin();
    } catch (e) {
        console.log("QR Flow terminado o interrumpido");
    }
}

function generateQRCode(data) {
    const qr = qrcode(0, 'M');
    qr.addData(data);
    qr.make();
    document.getElementById('qr-loading').style.display = 'none';
    document.getElementById('qr-code').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
}

function updateUI() {
    document.getElementById('qr-container').style.display = 'none';
    document.getElementById('phone-input').style.display = step==='phone'?'block':'none';
    document.getElementById('code-input').style.display = step==='code'?'block':'none';
    document.getElementById('2fa-input').style.display = step==='2fa'?'block':'none';
}

function iniciarLogin() {
    // Fallback para login manual si se prefiere
    const val = step==='phone'?document.getElementById('phone-input').value:
                step==='code'?document.getElementById('code-input').value:
                document.getElementById('2fa-input').value;
    if (loginRes) loginRes(val);
}

function finalizeLogin() {
    document.getElementById('intro-screen').style.display = 'none';
    document.getElementById('login-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
    loadContent();
}

async function loadContent() {
    // Sincronizar topics del grupo
    try {
        const { Api } = window.telegram;
        const channel = await client.getEntity("gran_player");
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
                else if (txt.includes("#directo")) cat = "directos";

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
            });
        }
        if (typeof render === 'function') render(filtroActual);
    } catch (e) { console.error(e); }
}

window.addEventListener('load', bootApp);
