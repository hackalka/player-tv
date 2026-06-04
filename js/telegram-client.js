// Master Config
const _aID = "ODk1Mjc0MQ==";
const _aHS = "NjkzZmIyZGExMjQ2NjJkYWQ4NWIyYjMzN2M1M2EzODY=";
const apiId = parseInt(atob(_aID));
const apiHash = atob(_aHS);

let client = null;
let loginResolver = null;
let step = 'phone';

async function initGramJS() {
    // Definir Buffer si la librería lo cargó pero no lo asignó a window
    if (typeof buffer !== 'undefined' && !window.Buffer) window.Buffer = buffer.Buffer;

    const tgLib = window.telegram;
    if (!tgLib || !window.Buffer) {
        console.log("⏳ Reintentando carga de librerías...");
        setTimeout(initGramJS, 500);
        return;
    }

    const { TelegramClient, Api } = tgLib;
    const { StringSession } = tgLib.sessions;
    const session = new StringSession(localStorage.getItem('tg_session') || "");

    client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5, useWSS: true });

    try {
        await client.connect();
        if (!await client.checkAuthorization()) {
            document.getElementById('login-modal').style.display = 'flex';
            await client.start({
                phoneNumber: async () => { step='phone'; return new Promise(r => loginResolver=r); },
                phoneCode: async () => { step='code'; updateUI(); return new Promise(r => loginResolver=r); },
                password: async () => { step='2fa'; updateUI(); return new Promise(r => loginResolver=r); },
                onError: (e) => alert(e.message)
            });
            localStorage.setItem('tg_session', client.session.save());
            document.getElementById('login-modal').style.display = 'none';
        }
        syncTelegram();
    } catch (e) {
        console.error("Connection Error:", e);
    }
}

function updateUI() {
    const msg = document.getElementById('login-msg');
    document.getElementById('phone-input').style.display = step==='phone'?'block':'none';
    document.getElementById('code-input').style.display = step==='code'?'block':'none';
    document.getElementById('2fa-input').style.display = step==='2fa'?'block':'none';
    msg.innerText = step==='code' ? 'Introduce el código recibido' : (step==='2fa'?'Introduce contraseña 2FA':'Escribe tu teléfono');
}

function iniciarLogin() {
    const val = step==='phone'?document.getElementById('phone-input').value:
                step==='code'?document.getElementById('code-input').value:
                document.getElementById('2fa-input').value;
    if (loginResolver) loginResolver(val);
}

async function syncTelegram() {
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
                const link = m.message.match(/[a-f0-9]{40}/) ? "acestream://" + m.message.match(/[a-f0-9]{40}/)[0] : (m.message.match(/https?:\/\/[^\s]+/) ? m.message.match(/https?:\/\/[^\s]+/)[0] : null);

                if (link && !base[cat].some(i => i.titulo === titulo)) {
                    base[cat].push({
                        titulo, link,
                        portada: m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i)?.[0] || "https://via.placeholder.com/160x230/111/f5c518?text=TV",
                        sinopsis: m.message,
                        catAsignada: cat
                    });
                }
            });
        }
        if (typeof render === 'function') render(filtroActual);
    } catch (e) { console.error("Sync Error:", e); }
}

window.mostrarCaps = function(items) {
    const box = document.getElementById('linksBox');
    box.innerHTML = '';
    items.forEach(i => {
        const d = document.createElement('div');
        d.className = "link-item";
        d.style = "background:#222; padding:15px; border-radius:10px; margin-bottom:10px; cursor:pointer;";
        d.innerHTML = `<i class="fa fa-play" style="color:#f5c518;"></i> ${i.titulo}`;
        d.onclick = () => {
            const p = document.getElementById('player-layer');
            const v = document.getElementById('main-video');
            p.style.display = 'flex';
            document.getElementById('video-info').innerText = i.titulo;

            if (i.link.includes('t.me/')) {
                const sUrl = i.link.replace("t.me/", "t.me/s/");
                fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(sUrl))
                    .then(r => r.json())
                    .then(data => {
                        const vid = data.contents.match(/<video[^>]*src="([^"]*)"/)?.[1];
                        if (vid) { v.src = vid; v.play(); } else { window.open(i.link, '_blank'); p.style.display='none'; }
                    });
            } else { v.src = i.link; v.play(); }
        };
        box.appendChild(d);
    });
};

function cerrarReproductor() {
    const v = document.getElementById('main-video');
    v.pause(); v.src = "";
    document.getElementById('player-layer').style.display = 'none';
}

window.addEventListener('load', () => setTimeout(initGramJS, 1000));
