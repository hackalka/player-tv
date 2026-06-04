/**
 * TELEGRAM TRUE STREAMING ENGINE (FIXED)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let tgClient = null;
let loginResolver = null;
let loginStep = 'qr';

async function registerStreamingSW() {
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('sw.js');
            console.log("Streaming SW OK");

            navigator.serviceWorker.ready.then((reg) => {
                const chan = new MessageChannel();
                chan.port1.onmessage = (e) => {
                    const { type, requestId, streamId, start, size } = e.data;
                    if (type === 'FETCH_RANGE') handleRangeRequest(requestId, streamId, start, size, e.target);
                };
                reg.active.postMessage({ type: 'INIT' }, [chan.port2]);
            });
        } catch (e) { console.error("SW fail:", e); }
    }
}

async function handleRangeRequest(rid, sid, start, size, port) {
    try {
        const [chatId, msgId] = sid.split('-');
        const msgs = await tgClient.getMessages(chatId, { ids: [parseInt(msgId)] });
        const buf = await tgClient.downloadMedia(msgs[0].media, {
            start: BigInt(start),
            end: BigInt(start + size - 1),
            workers: 1
        });
        port.postMessage({ requestId: rid, chunk: buf });
    } catch (err) { port.postMessage({ requestId: rid, error: err.message }); }
}

async function startBoot() {
    // Espera crítica de librerías
    if (!window.telegram || !window.Buffer) {
        setTimeout(startBoot, 500);
        return;
    }

    await registerStreamingSW();

    const { TelegramClient, Api } = window.telegram;
    const { StringSession } = window.telegram.sessions;

    const session = new StringSession(localStorage.getItem('tg_session') || "");
    tgClient = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5, useWSS: true });

    try {
        document.getElementById('boot-status').innerText = "Estableciendo conexión...";
        await tgClient.connect();

        if (!await tgClient.checkAuthorization()) {
            document.getElementById('loader-screen').style.display = 'none';
            document.getElementById('login-modal').style.display = 'flex';
            startQR();
        } else {
            finalizeBoot();
        }
    } catch (e) {
        console.error(e);
        document.getElementById('boot-status').innerText = "Error de red. Reintentando...";
    }
}

async function startQR() {
    try {
        await tgClient.signInUserWithQrCode({ apiId: API_ID, apiHash: API_HASH }, {
            onError: (err) => {
                if (err.message.includes("SESSION_PASSWORD_NEEDED")) {
                    loginStep = '2fa'; updateLoginUI();
                } else alert("Error: " + err.message);
            },
            qrCode: async (code) => {
                const url = `tg://login?token=${code.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
                const qr = qrcode(0, 'M');
                qr.addData(url);
                qr.make();
                document.getElementById('qr-loading').style.display = 'none';
                document.getElementById('qr-code').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
            }
        });
        finalizeBoot();
    } catch (e) {}
}

function finalizeBoot() {
    localStorage.setItem('tg_session', tgClient.session.save());
    document.getElementById('loader-screen').style.display = 'none';
    document.getElementById('login-modal').style.display = 'none';
    syncData();
}

async function syncData() {
    try {
        const { Api } = window.telegram;
        const chatId = "gran_player";
        const ent = await tgClient.getEntity(chatId);
        const full = await tgClient.invoke(new Api.channels.GetFullChannel({ channel: ent }));
        const topics = full.fullChat.topics.topics || [];

        for (const t of topics) {
            const msgs = await tgClient.getMessages(ent, { replyTo: t.id, limit: 30 });
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
                        chatId: chatId, msgId: m.id,
                        portada: m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i)?.[0] || "https://via.placeholder.com/160x230/111/f5c518?text=PREVIEW",
                        sinopsis: m.message, catAsignada: cat
                    });
                }
            });
        }
        if (typeof render === 'function') render('inicio');
    } catch (e) { console.error(e); }
}

window.playVideo = async function(titulo, item) {
    const player = document.getElementById('player-layer');
    const video = document.getElementById('main-video');
    player.style.display = 'flex';

    if (item.msgId && item.chatId) {
        const msgs = await tgClient.getMessages(item.chatId, { ids: [parseInt(item.msgId)] });
        const media = msgs[0]?.media;
        const size = media?.document?.size || media?.video?.size;
        const mime = media?.document?.mimeType || media?.video?.mimeType || 'video/mp4';

        if (size) {
            const sid = `${item.chatId}-${item.msgId}`;
            navigator.serviceWorker.controller.postMessage({
                type: 'REGISTER', streamId: sid,
                fileSize: Number(size), mimeType: mime
            });
            video.src = `tg-stream/${sid}`;
            video.play();
            return;
        }
    }
    video.src = item.link;
    video.play();
};

window.addEventListener('load', startBoot);
