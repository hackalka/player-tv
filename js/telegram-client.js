/**
 * MOTOR DE TELEGRAM (OPCIÓN A - FIXED FRONTEND)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let tgClient = null;

async function boot() {
    console.log("🚀 Arrancando motor...");

    // OPCIÓN B: Evitar bucle infinito si la arquitectura falla
    const lib = window.gramjs || window.telegram;

    if (!lib || !window.Buffer) {
        console.error("❌ Falta librería real (GramJS o Buffer). STOP.");
        document.getElementById('boot-status').innerHTML = "<span style='color:red;'>ERROR DE ARQUITECTURA: LIBRERÍA NO SOPORTADA</span>";
        return; // Detenemos el proceso aquí.
    }

    const { TelegramClient, sessions } = lib;
    const session = new sessions.StringSession(localStorage.getItem('tg_session') || "");

    tgClient = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true
    });

    try {
        document.getElementById('boot-status').innerText = "CONECTANDO...";
        await tgClient.connect();

        if (!await tgClient.checkAuthorization()) {
            document.getElementById('loader-screen').style.display = 'none';
            document.getElementById('login-modal').style.display = 'flex';
            iniciarQR();
        } else {
            document.getElementById('loader-screen').style.display = 'none';
            sincronizar();
        }
    } catch (e) {
        console.error(e);
        document.getElementById('boot-status').innerText = "FALLO DE RED";
    }
}

async function iniciarQR() {
    try {
        await tgClient.signInUserWithQrCode({ apiId: API_ID, apiHash: API_HASH }, {
            qrCode: async (code) => {
                const url = `tg://login?token=${code.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
                const qr = qrcode(0, 'M');
                qr.addData(url);
                qr.make();
                document.getElementById('qr-loading').style.display = 'none';
                document.getElementById('qr-code').innerHTML = qr.createSvgTag({ cellSize: 4 });
            }
        });
        location.reload(); // Recargar tras éxito
    } catch (e) {}
}

async function sincronizar() {
    try {
        const { Api } = window.gramjs || window.telegram;
        const channel = await tgClient.getEntity("gran_player");
        const full = await tgClient.invoke(new Api.channels.GetFullChannel({ channel }));
        const topics = full.fullChat.topics.topics || [];

        for (const t of topics) {
            const msgs = await tgClient.getMessages(channel, { replyTo: t.id, limit: 20 });
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

window.addEventListener('load', () => setTimeout(boot, 1000));
