// Configuración del Cliente
const _0x1 = "ODk1Mjc0MQ==";
const _0x2 = "NjkzZmIyZGExMjQ2NjJkYWQ4NWIyYjMzN2M1M2EzODY=";
const apiId = parseInt(atob(_0x1));
const apiHash = atob(_0x2);

let client = null;
let loginResolver = null;
let step = 'phone';

async function initGramJS() {
    const tgLib = window.telegram;
    if (!tgLib || !window.Buffer) {
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
                phoneCode: async () => { step='code'; updateLoginUI(); return new Promise(r => loginResolver=r); },
                password: async () => { step='2fa'; updateLoginUI(); return new Promise(r => loginResolver=r); },
                onError: (e) => alert(e.message)
            });
            localStorage.setItem('tg_session', client.session.save());
            document.getElementById('login-modal').style.display = 'none';
        }
        cargarDesdeTelegram();
    } catch (e) {
        console.error(e);
    }
}

function updateLoginUI() {
    document.getElementById('phone-input').style.display = step==='phone'?'block':'none';
    document.getElementById('code-input').style.display = step==='code'?'block':'none';
    document.getElementById('2fa-input').style.display = step==='2fa'?'block':'none';
    document.getElementById('login-msg').innerText = step==='code'?'Introduce el código':'Introduce el 2FA';
}

function iniciarLogin() {
    const v = step==='phone'?document.getElementById('phone-input').value:
              step==='code'?document.getElementById('code-input').value:
              document.getElementById('2fa-input').value;
    if (loginResolver) loginResolver(v);
}

async function cargarDesdeTelegram() {
    try {
        const { Api } = window.telegram;
        const channel = await client.getEntity("gran_player");
        const full = await client.invoke(new Api.channels.GetFullChannel({ channel }));
        const topics = full.fullChat.topics.topics || [];

        for (const t of topics) {
            const msgs = await client.getMessages(channel, { replyTo: t.id, limit: 50 });
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
    } catch (e) { console.error(e); }
}

function extraerLink(m) {
    const ace = m.match(/[a-f0-9]{40}/);
    if (ace) return "acestream://" + ace[0];
    const url = m.match(/https?:\/\/[^\s]+/);
    return url ? url[0] : null;
}

function extraerImg(m) {
    const img = m.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i);
    return img ? img[0] : "https://via.placeholder.com/160x230/111/f5c518?text=TV";
}

window.mostrarCaps = function(items) {
    const box = document.getElementById('linksBox');
    box.innerHTML = '';
    items.forEach(i => {
        const d = document.createElement('div');
        d.className = "link-item";
        d.innerHTML = `<i class="fa fa-play"></i> ${i.titulo}`;
        d.onclick = () => playVideo(i.titulo, i.link);
        box.appendChild(d);
    });
};

async function playVideo(t, u) {
    const p = document.getElementById('player-layer');
    const v = document.getElementById('main-video');
    p.style.display = 'flex';
    document.getElementById('video-info').innerText = t;

    if (u.includes('t.me/')) {
        const sUrl = u.replace("t.me/", "t.me/s/");
        const res = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(sUrl));
        const data = await res.json();
        const videoUrl = data.contents.match(/<video[^>]*src="([^"]*)"/)?.[1];
        if (videoUrl) { v.src = videoUrl; v.play(); } else { window.open(u, '_blank'); p.style.display='none'; }
    } else { v.src = u; v.play(); }
}

function cerrarReproductor() {
    const v = document.getElementById('main-video');
    v.pause(); v.src = "";
    document.getElementById('player-layer').style.display = 'none';
}

window.addEventListener('load', () => setTimeout(initGramJS, 1000));
