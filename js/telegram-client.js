/**
 * MOTOR DE TELEGRAM (VERSIÓN AUTO-REPARABLE)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let tgClient = null;
let loginRes = null;
let step = 'phone';

function updateStatus(msg) {
    const el = document.getElementById('status-text');
    if (el) el.innerText = msg;
}

async function startEngine() {
    // Verificamos si Buffer está disponible, si no, lo inyectamos de nuevo
    if (typeof window.Buffer === 'undefined' && typeof window.buffer !== 'undefined') {
        window.Buffer = window.buffer.Buffer;
    }

    if (!window.telegram || !window.Buffer) {
        console.log("⏳ Reintentando cargar librerías...");
        setTimeout(startEngine, 1000);
        return;
    }

    const { TelegramClient, sessions } = window.telegram;
    const session = new sessions.StringSession(localStorage.getItem('tg_session') || "");

    tgClient = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true
    });

    try {
        updateStatus("Estableciendo conexión segura...");
        await tgClient.connect();

        const isAuth = await tgClient.checkAuthorization();
        if (!isAuth) {
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

        updateStatus("Sincronizando contenido...");
        loadTelegramContent();

    } catch (e) {
        console.error(e);
        updateStatus("Fallo al conectar con Telegram. Reintenta.");
    }
}

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
        const entity = await tgClient.getEntity("gran_player");
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
                else if (txt.includes("#directo")) cat = "directos";
                else if (txt.includes("#agenda")) cat = "agenda";

                const titulo = m.message.split('\n')[0].replace(/#\w+/g, '').trim();
                const link = m.message.match(/https?:\/\/[^\s]+/)?.[0];

                if (link && !base[cat].some(i => i.titulo === titulo)) {
                    base[cat].push({
                        titulo, link,
                        portada: m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i)?.[0] || "https://via.placeholder.com/160x230/111/f5c518?text=PREVIEW",
                        sinopsis: m.message,
                        catAsignada: cat
                    });
                }
            });
        }
        if (typeof render === 'function') render(filtroActual);
        else console.error("No se encontró la función render");
    } catch (e) {
        console.error(e);
    }
}

// Iniciar cuando todo esté listo
window.addEventListener('load', startEngine);
