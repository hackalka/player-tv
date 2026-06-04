/**
 * ENGINE MASTER: PURE TELEGRAM (NO FIREBASE)
 */

// REGISTRO DE STREAMING
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
        navigator.serviceWorker.ready.then(r => {
            const chan = new MessageChannel();
            chan.port1.onmessage = async (e) => {
                const { type, requestId, streamId, start, size } = e.data;
                if (type === 'FETCH_RANGE') {
                    const [chatId, msgId] = streamId.split('-');
                    // window.client es definido en telegram-client.js
                    const msgs = await window.tgClient.getMessages(chatId, { ids: [parseInt(msgId)] });
                    const chunk = await window.tgClient.downloadMedia(msgs[0].media, {
                        start: BigInt(start),
                        end: BigInt(start + size - 1),
                        workers: 1
                    });
                    e.target.postMessage({ requestId, chunk });
                }
            };
            r.active.postMessage({ type: 'INIT' }, [chan.port2]);
        });
    });
}

// REPRODUCTOR REAL (SIN TVGRAM://)
window.playVideo = async function(titulo, msg) {
    const layer = document.getElementById('player-layer');
    const video = document.getElementById('main-video');
    const info = document.getElementById('video-info');

    layer.style.display = 'flex';
    info.innerText = titulo;
    video.src = ""; // Reset

    if (msg.media) {
        const size = msg.media.document?.size || msg.media.video?.size;
        if (size) {
            const streamId = `gran_player-${msg.id}`;
            navigator.serviceWorker.controller.postMessage({
                type: 'REGISTER', streamId, fileSize: Number(size), mimeType: 'video/mp4'
            });
            video.src = `tg-stream/${streamId}`;
            video.play();
            return;
        }
    }

    // Fallback: Si es un link normal en el mensaje
    const link = msg.message?.match(/https?:\/\/[^\s]+/)?.[0];
    if (link) {
        video.src = link;
        video.play();
    } else {
        alert("Este mensaje no contiene un video reproducible.");
        layer.style.display = 'none';
    }
};

window.cerrarReproductor = function() {
    const v = document.getElementById('main-video');
    v.pause(); v.src = "";
    document.getElementById('player-layer').style.display = 'none';
};
