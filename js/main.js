/**
 * MAIN UI & STREAMING ENGINE
 */

// Registrar Service Worker para Streaming
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
        console.log("SW Streaming Activo");
        navigator.serviceWorker.ready.then(r => {
            const chan = new MessageChannel();
            chan.port1.onmessage = handleStreamRequest;
            r.active.postMessage({ type: 'INIT' }, [chan.port2]);
        });
    });
}

async function handleStreamRequest(e) {
    const { type, requestId, streamId, start, size } = e.data;
    if (type === 'FETCH_RANGE') {
        const [chatId, msgId] = streamId.split('-');
        // Pedir al cliente de telegram el trozo
        const buf = await window.client.downloadMedia(window.currentMedia, {
            start: BigInt(start),
            end: BigInt(start + size - 1),
            workers: 1
        });
        e.target.postMessage({ requestId, chunk: buf });
    }
}

window.playVideo = async function(titulo, msg) {
    const player = document.getElementById('player-layer');
    const video = document.getElementById('main-video');

    player.style.display = 'flex';

    if (msg.media) {
        window.currentMedia = msg.media;
        const fileSize = msg.media.document?.size || msg.media.video?.size;
        const streamId = `gran_player-${msg.id}`;

        navigator.serviceWorker.controller.postMessage({
            type: 'REGISTER',
            streamId,
            fileSize: Number(fileSize),
            mimeType: 'video/mp4'
        });

        video.src = `tg-stream/${streamId}`;
        video.play();
    } else {
        const link = msg.message.match(/https?:\/\/[^\s]+/)?.[0];
        if (link) {
            video.src = link;
            video.play();
        }
    }
};

function cerrarReproductor() {
    const v = document.getElementById('main-video');
    v.pause(); v.src = "";
    document.getElementById('player-layer').style.display = 'none';
}
