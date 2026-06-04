/**
 * TELEGRAM ENGINE (BULLETPROOF BROWSER VERSION)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let client = null;
let loginRes = null;
let loginStep = 'phone';

async function bootTelegram() {
    console.log("🚀 Iniciando Telegram...");

    // Esperar a que window.telegram y window.Buffer existan
    if (!window.telegram || !window.Buffer) {
        setTimeout(bootTelegram, 500);
        return;
    }

    const { TelegramClient, Api } = window.telegram;
    const { StringSession } = window.telegram.sessions;

    const session = new StringSession(localStorage.getItem('tg_session') || "");

    client = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true
    });

    try {
        await client.connect();

        if (!await client.checkAuthorization()) {
            document.getElementById('login-modal').style.display = 'flex';
            await client.start({
                phoneNumber: async () => { loginStep='phone'; return new Promise(r => loginRes=r); },
                phoneCode: async () => { loginStep='code'; updateUI(); return new Promise(r => loginRes=r); },
                password: async () => { loginStep='2fa'; updateUI(); return new Promise(r => loginRes=r); },
                onError: (err) => alert("Telegram Error: " + err.message)
            });
            localStorage.setItem('tg_session', client.session.save());
            document.getElementById('login-modal').style.display = 'none';
        }

        console.log("✅ Conectado!");
        fetchTelegramContent();
    } catch (e) {
        console.error("Fallo de conexión:", e);
    }
}

function updateUI() {
    document.getElementById('phone-input').style.display = loginStep==='phone'?'block':'none';
    document.getElementById('code-input').style.display = loginStep==='code'?'block':'none';
    document.getElementById('2fa-input').style.display = loginStep==='2fa'?'block':'none';
    document.getElementById('login-msg').innerText = loginStep==='code'?'Introduce el código':'Introduce el 2FA';
}

function iniciarLogin() {
    const v = loginStep==='phone' ? document.getElementById('phone-input').value :
              loginStep==='code'  ? document.getElementById('code-input').value :
                                    document.getElementById('2fa-input').value;
    if (loginRes && v) loginRes(v);
}

async function fetchTelegramContent() {
    const container = document.getElementById('content');
    container.innerHTML = '<div style="text-align:center; padding:20px; color:gold;">Sincronizando contenido...</div>';

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
                else if (txt.includes("#agenda")) cat = "agenda";

                const titulo = m.message.split('\n')[0].replace(/#\w+/g, '').trim();
                const link = extraerLink(m.message);

                if (link && !base[cat].some(i => i.titulo === titulo)) {
                    base[cat].push({
                        titulo, link,
                        portada: extraerImg(m.message),
                        sinopsis: m.message,
                        catAsignada: cat
                    });
                }
            });
        }
        if (typeof render === 'function') render(filtroActual);
    } catch (e) {
        console.error("Error cargando topics:", e);
        container.innerHTML = '<div style="text-align:center; color:red;">Error al cargar contenido de Telegram.</div>';
    }
}

function extraerLink(m) {
    const ace = m.match(/[a-f0-9]{40}/);
    if (ace) return "acestream://" + ace[0];
    const url = m.match(/https?:\/\/[^\s]+/);
    return url ? url[0] : null;
}

function extraerImg(m) {
    const img = m.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i);
    return img ? img[0] : "https://via.placeholder.com/160x230/111/f5c518?text=PREVIEW";
}

// Iniciar
window.addEventListener('load', () => setTimeout(bootTelegram, 500));
