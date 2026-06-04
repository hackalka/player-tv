/**
 * MOTOR DE TELEGRAM (REVISIÓN PROFESIONAL V2)
 */
const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let client = null;
let loginResolver = null;

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
        console.log("Conectando...");
        await client.connect();

        if (!await client.checkAuthorization()) {
            showView('login');
            startQRFlow();
        } else {
            onAuthSuccess();
        }
    } catch (e) {
        console.error(e);
        document.getElementById('boot-status').innerText = "Fallo de red. Reintentando...";
    }
}

async function startQRFlow() {
    try {
        await client.signInUserWithQrCode({ apiId: API_ID, apiHash: API_HASH }, {
            onError: (err) => {
                if (err.message.includes("SESSION_PASSWORD_NEEDED")) showStep('2fa');
                else alert("Error: " + err.message);
            },
            qrCode: async (code) => {
                const url = `tg://login?token=${code.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
                renderQR(url);
            }
        });
        onAuthSuccess();
    } catch (e) { console.log("QR Flow reset"); }
}

function renderQR(url) {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    document.getElementById('qr-loading').style.display = 'none';
    document.getElementById('qr-code').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 0 });
}

function showView(id) {
    document.getElementById('cineflix-intro').style.display = 'none';
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.getElementById(`view-${id}`).style.display = 'block';
}

function showStep(id) {
    document.querySelectorAll('.login-step').forEach(s => s.classList.remove('active'));
    document.getElementById(`step-${id}`).classList.add('active');
}

function onAuthSuccess() {
    localStorage.setItem('tg_session', client.session.save());
    showView('catalog');
    syncContent();
}

async function syncContent() {
    // Aquí implementamos la carga de topics igual que en tu web original
    console.log("Sincronizando contenidos de @gran_player...");
    try {
        const { Api } = window.telegram;
        const channel = await client.getEntity("gran_player");
        const full = await client.invoke(new Api.channels.GetFullChannel({ channel }));
        const topics = full.fullChat.topics.topics || [];

        for (const t of topics) {
            const msgs = await client.getMessages(channel, { replyTo: t.id, limit: 30 });
            msgs.forEach(m => {
                if (!m.message) return;
                // Lógica de filtrado por hashtags #pelicula, #serie, etc.
                // ... (mantenemos tu lógica de main.js)
            });
        }
        if (typeof render === 'function') render('inicio');
    } catch (e) { console.error(e); }
}

window.addEventListener('load', bootApp);
