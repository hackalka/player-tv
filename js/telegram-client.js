/**
 * MOTOR DE TELEGRAM (RESILIENT MASTER EDITION)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";
const GROUP_ID = "gran_player";

let tgClient = null;
let loginRes = null;

async function bootSystem() {
    console.log("🚀 Iniciando arranque seguro...");

    // Forzado manual de Buffer si falló el script previo
    if (typeof window.Buffer === 'undefined' && window.buffer?.Buffer) {
        window.Buffer = window.buffer.Buffer;
    }

    const lib = window.telegram || window.gramjs;

    // OPCIÓN B: Detener bucle si no hay librerías
    if (!lib || !window.Buffer) {
        console.error("❌ Fallo de Arquitectura: Telegram o Buffer no cargados.");
        document.getElementById('boot-status').innerHTML = "<span style='color:#ff4436;'>ERROR: LIBRERÍA BLOQUEADA POR EL NAVEGADOR</span>";
        return;
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
            runQR();
        } else {
            onAuthorized();
        }
    } catch (e) {
        console.error("Error de arranque:", e);
        document.getElementById('boot-status').innerText = "FALLO DE CONEXIÓN. REINTENTANDO...";
        setTimeout(bootSystem, 3000);
    }
}

async function runQR() {
    try {
        await tgClient.signInUserWithQrCode({ apiId: API_ID, apiHash: API_HASH }, {
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
        location.reload();
    } catch (e) {}
}

function onAuthorized() {
    localStorage.setItem('tg_session', tgClient.session.save());
    document.getElementById('loader-screen').style.display = 'none';
    document.getElementById('login-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
    syncTelegram();
}

async function syncTelegram() {
    try {
        const { Api } = window.telegram || window.gramjs;
        const entity = await tgClient.getEntity(GROUP_ID);
        const full = await tgClient.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        const topics = full.fullChat.topics.topics || [];

        renderNav(topics);
        if (topics.length > 0) loadTopicContent(topics[0].id);

    } catch (e) { console.error("Sync Error:", e); }
}

function renderNav(topicsList) {
    const nav = document.getElementById('main-nav');
    if (!nav) return;
    nav.innerHTML = '';
    topicsList.forEach((t, idx) => {
        const btn = document.createElement('button');
        btn.className = `f-btn ${idx === 0 ? 'active' : ''}`;
        btn.innerText = t.title.toUpperCase();
        btn.onclick = () => {
            document.querySelectorAll('.f-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadTopicContent(t.id);
        };
        nav.appendChild(btn);
    });
}

async function loadTopicContent(topicId) {
    const container = document.getElementById('content');
    container.innerHTML = '<div style="text-align:center; padding:50px; color:gold;">Cargando contenido...</div>';

    try {
        const entity = await tgClient.getEntity(GROUP_ID);
        const msgs = await tgClient.getMessages(entity, { replyTo: topicId, limit: 40 });

        const grid = document.createElement('div');
        grid.style = "display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 15px; padding: 10px;";

        msgs.forEach(m => {
            if (!m.message) return;
            const titulo = m.message.split('\n')[0].replace(/#\w+/g, '').trim();
            const card = document.createElement('div');
            card.style = "background:#111; border-radius:12px; overflow:hidden; border:1px solid #222; cursor:pointer;";
            card.innerHTML = `
                <img src="${m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i)?.[0] || 'https://via.placeholder.com/145x200/111/f5c518?text=TV'}" style="width:100%; height:190px; object-fit:cover;">
                <div style="padding:10px; text-align:center; font-size:12px; font-weight:bold;">${titulo}</div>
            `;
            card.onclick = () => window.playVideo(titulo, m);
            grid.appendChild(card);
        });
        container.innerHTML = '';
        container.appendChild(grid);
    } catch (e) { console.error(e); }
}

window.addEventListener('load', () => setTimeout(bootSystem, 1000));
