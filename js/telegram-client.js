/**
 * MOTOR DE TELEGRAM (OFFICIAL GRAMJS BROWSER IMPLEMENTATION)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let tgClient = null;
let loginStep = 'qr';

async function bootApp() {
    console.log("🛠 Iniciando motor...");

    // En el navegador, GramJS suele registrarse como 'gramjs' o 'telegram'
    const lib = window.gramjs || window.telegram;

    if (!lib || !window.Buffer) {
        console.warn("⏳ Reintentando carga de librerías...");
        setTimeout(bootApp, 500);
        return;
    }

    const { TelegramClient, sessions } = lib;
    const session = new sessions.StringSession(localStorage.getItem('tg_session') || "");

    tgClient = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true
    });

    try {
        document.getElementById('boot-status').innerText = "Conectando...";
        await tgClient.connect();

        if (!await tgClient.checkAuthorization()) {
            document.getElementById('loader-screen').style.display = 'none';
            document.getElementById('login-modal').style.display = 'flex';
            startQRLogin();
        } else {
            onAuthorized();
        }
    } catch (e) {
        console.error(e);
        document.getElementById('boot-status').innerText = "Error. Reintentando...";
    }
}

async function startQRLogin() {
    const lib = window.gramjs || window.telegram;
    try {
        await tgClient.signInUserWithQrCode({ apiId: API_ID, apiHash: API_HASH }, {
            onError: (err) => {
                if (err.message.includes("SESSION_PASSWORD_NEEDED")) {
                    alert("Se requiere contraseña 2FA.");
                }
            },
            qrCode: async (code) => {
                const url = `tg://login?token=${code.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
                renderQR(url);
            }
        });
        onAuthorized();
    } catch (e) {}
}

function renderQR(url) {
    if (!window.qrcode) return;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    document.getElementById('qr-loading').style.display = 'none';
    document.getElementById('qr-code').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
}

function onAuthorized() {
    localStorage.setItem('tg_session', tgClient.session.save());
    document.getElementById('loader-screen').style.display = 'none';
    document.getElementById('login-modal').style.display = 'none';
    syncData();
}

async function syncData() {
    const lib = window.gramjs || window.telegram;
    const { Api } = lib;
    try {
        const channelId = "gran_player";
        const entity = await tgClient.getEntity(channelId);
        const full = await tgClient.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        const topics = full.fullChat.topics.topics || [];

        for (const t of topics) {
            const msgs = await tgClient.getMessages(entity, { replyTo: t.id, limit: 30 });
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
                        portada: m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i)?.[0] || "https://via.placeholder.com/160x230/111/f5c518?text=TV",
                        sinopsis: m.message, catAsignada: cat
                    });
                }
            });
        }
        if (typeof render === 'function') render('inicio');
    } catch (e) { console.error(e); }
}

window.addEventListener('load', bootApp);
