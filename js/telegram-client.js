/**
 * TELEGRAM CLIENT ENGINE (NO FIREBASE EDITION)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";
const GROUP_ID = "gran_player";

let client = null;
let topics = [];
let base = {}; // Categorías dinámicas

async function initTelegram() {
    if (!window.telegram || !window.Buffer) {
        setTimeout(initTelegram, 500);
        return;
    }

    const { TelegramClient, sessions } = window.telegram;
    const session = new sessions.StringSession(localStorage.getItem('tg_session') || "");

    client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5, useWSS: true });

    try {
        await client.connect();
        if (!await client.checkAuthorization()) {
            document.getElementById('loader-screen').style.display = 'none';
            document.getElementById('login-modal').style.display = 'flex';
            runQR();
        } else {
            onConnected();
        }
    } catch (e) { console.error(e); }
}

async function runQR() {
    try {
        await client.signInUserWithQrCode({ apiId: API_ID, apiHash: API_HASH }, {
            qrCode: async (code) => {
                const url = `tg://login?token=${code.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
                const qr = qrcode(0, 'M');
                qr.addData(url);
                qr.make();
                document.getElementById('qr-loading').style.display = 'none';
                document.getElementById('qr-code').innerHTML = qr.createSvgTag({ cellSize: 4 });
            }
        });
        location.reload();
    } catch (e) {}
}

async function onConnected() {
    localStorage.setItem('tg_session', client.session.save());
    document.getElementById('loader-screen').style.display = 'none';

    // Cargar Topics
    try {
        const { Api } = window.telegram;
        const entity = await client.getEntity(GROUP_ID);
        const full = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        topics = full.fullChat.topics.topics || [];

        // Crear navegación basada en Topics
        renderNav(topics);

        // Cargar primer topic por defecto
        if (topics.length > 0) loadTopic(topics[0].id, topics[0].title);

    } catch (e) { console.error(e); }
}

function renderNav(topicsList) {
    const nav = document.getElementById('main-nav');
    nav.innerHTML = '';
    topicsList.forEach((t, idx) => {
        const btn = document.createElement('button');
        btn.className = `f-btn ${idx === 0 ? 'active' : ''}`;
        btn.innerText = t.title.toUpperCase();
        btn.onclick = () => {
            document.querySelectorAll('.f-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadTopic(t.id, t.title);
        };
        nav.appendChild(btn);
    });
}

async function loadTopic(topicId, topicName) {
    const container = document.getElementById('content');
    container.innerHTML = '<div style="text-align:center; padding:50px;">Cargando...</div>';

    try {
        const entity = await client.getEntity(GROUP_ID);
        const msgs = await client.getMessages(entity, { replyTo: topicId, limit: 50 });

        const grid = document.createElement('div');
        grid.style = "display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 15px; padding: 10px;";

        msgs.forEach(m => {
            if (!m.message) return;
            const titulo = m.message.split('\n')[0].replace(/#\w+/g, '').trim();
            const portada = m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i)?.[0] || "https://via.placeholder.com/150x220/111/f5c518?text=VIDEO";

            const card = document.createElement('div');
            card.style = "background:#111; border-radius:10px; overflow:hidden; border:1px solid #222; cursor:pointer;";
            card.innerHTML = `
                <img src="${portada}" style="width:100%; height:200px; object-fit:cover;">
                <div style="padding:10px; text-align:center; font-size:12px; font-weight:bold;">${titulo}</div>
            `;
            card.onclick = () => window.playVideo(titulo, m);
            grid.appendChild(card);
        });

        container.innerHTML = '';
        container.appendChild(grid);
    } catch (e) { console.error(e); }
}

window.addEventListener('load', initTelegram);
