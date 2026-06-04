/**
 * TELEGRAM ENGINE PRO - REVISIÓN MAESTRA
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let client = null;
let loginRes = null;
let loginStep = 'phone';

// Función para actualizar el estado en la pantalla
function setStatus(msg, isError = false) {
    const container = document.getElementById('content');
    if (container) {
        container.innerHTML = `<div style="text-align:center; padding:50px; color:${isError ? '#ff4436' : '#f5c518'}; font-family:sans-serif;">
            <div class="spinner" style="margin: 0 auto 20px; border: 4px solid rgba(255,255,255,0.1); border-left-color: #f5c518; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite;"></div>
            <p style="font-size:18px; font-weight:bold;">${msg}</p>
        </div>`;
    }
    console.log(isError ? "❌ " : "⏳ ", msg);
}

async function bootTelegram() {
    if (!window.telegram || !window.Buffer) {
        setStatus("Cargando librerías de seguridad...");
        setTimeout(bootTelegram, 500);
        return;
    }

    const { TelegramClient, Api } = window.telegram;
    const { StringSession } = window.telegram.sessions;

    // Limpieza de sesión si algo va mal
    let sessionStr = localStorage.getItem('tg_session') || "";
    const session = new StringSession(sessionStr);

    setStatus("Estableciendo conexión segura con Telegram...");

    client = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 10,
        useWSS: true,
        autoReconnect: true,
        timeout: 10000 // 10 segundos de timeout
    });

    try {
        await client.connect();

        const isAuth = await client.checkAuthorization();

        if (!isAuth) {
            setStatus("Esperando identificación del usuario...");
            document.getElementById('login-modal').style.display = 'flex';

            await client.start({
                phoneNumber: async () => {
                    loginStep = 'phone';
                    updateUI();
                    return new Promise(r => loginRes = r);
                },
                phoneCode: async () => {
                    loginStep = 'code';
                    updateUI();
                    return new Promise(r => loginRes = r);
                },
                password: async () => {
                    loginStep = '2fa';
                    updateUI();
                    return new Promise(r => loginRes = r);
                },
                onError: (err) => {
                    alert("Error de Telegram: " + err.message);
                    localStorage.removeItem('tg_session');
                    location.reload();
                }
            });

            localStorage.setItem('tg_session', client.session.save());
            document.getElementById('login-modal').style.display = 'none';
        }

        setStatus("¡Conexión exitosa! Sincronizando tus videos...");
        await fetchTelegramContent();

    } catch (e) {
        setStatus("Fallo al conectar. Telegram está saturado o tu red bloquea la conexión.", true);
        console.error("Error crítico:", e);
    }
}

function updateUI() {
    const modal = document.getElementById('login-modal');
    if (!modal) return;

    document.getElementById('phone-input').style.display = loginStep === 'phone' ? 'block' : 'none';
    document.getElementById('code-input').style.display = loginStep === 'code' ? 'block' : 'none';
    document.getElementById('2fa-input').style.display = loginStep === '2fa' ? 'block' : 'none';

    const msg = document.getElementById('login-msg');
    if (loginStep === 'code') msg.innerText = "Introduce el código que te acaba de llegar a Telegram:";
    if (loginStep === '2fa') msg.innerText = "Introduce tu contraseña de Verificación en 2 Pasos:";
}

function iniciarLogin() {
    const val = loginStep === 'phone' ? document.getElementById('phone-input').value :
                loginStep === 'code' ? document.getElementById('code-input').value :
                document.getElementById('2fa-input').value;

    if (loginRes && val) {
        loginRes(val);
    } else {
        alert("Por favor, rellena el campo.");
    }
}

async function fetchTelegramContent() {
    try {
        const { Api } = window.telegram;
        const channelId = "gran_player";

        const channel = await client.getEntity(channelId);
        const fullChannel = await client.invoke(new Api.channels.GetFullChannel({ channel }));
        const topics = fullChannel.fullChat.topics?.topics || [];

        console.log(`Cargando ${topics.length} temas...`);

        // Carga rápida
        for (const topic of topics) {
            const messages = await client.getMessages(channel, { replyTo: topic.id, limit: 20 });
            messages.forEach(m => {
                if (!m.message) return;
                procesarMensajeTelegram(m);
            });
        }

        if (typeof render === 'function') render(filtroActual);
        else setStatus("Error interno: La interfaz no puede renderizar.");

    } catch (e) {
        console.error("Error en sincronización:", e);
        setStatus("Error al leer el canal @gran_player. Asegúrate de ser miembro.", true);
    }
}

function procesarMensajeTelegram(m) {
    const texto = m.message.toLowerCase();
    let cat = "inicio";
    if (texto.includes("#pelicula")) cat = "peliculas";
    else if (texto.includes("#serie")) cat = "series";
    else if (texto.includes("#directo")) cat = "directos";
    else if (texto.includes("#agenda")) cat = "agenda";

    const titulo = m.message.split('\n')[0].replace(/#\w+/g, '').trim();
    const link = m.message.match(/https?:\/\/[^\s]+/) ? m.message.match(/https?:\/\/[^\s]+/)[0] : null;

    if (link && !base[cat].some(i => i.titulo === titulo)) {
        base[cat].push({
            titulo, link,
            portada: m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i)?.[0] || "https://via.placeholder.com/160x230/111/f5c518?text=PREVIEW",
            sinopsis: m.message,
            catAsignada: cat
        });
    }
}

// Estilos dinámicos para el loader
const style = document.createElement('style');
style.innerHTML = `@keyframes spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(style);

window.addEventListener('load', () => setTimeout(bootTelegram, 500));
