/**
 * MAIN ENGINE - FRONTEND PURE EDITION (FIREBASE V10)
 */
let base = { peliculas: [], series: [], directos: [], agenda: [], destacados: null };
let filtroActual = 'inicio';

window.initApp = function() {
    console.log("🚀 Iniciando aplicación...");
    cargarContenido();
};

function cargar() {
    if (!window.db) return;

    // Cargar datos de Firebase (v10 Style)
    ['peliculas', 'series', 'directos', 'agenda'].forEach(cat => {
        const reference = window.dbRef(window.db, cat);
        window.dbOnValue(reference, snap => {
            const data = snap.val() || {};
            base[cat] = Object.keys(data).map(k => ({ ...data[k], firebaseKey: k, catAsignada: cat }));
            render(filtroActual);
        });
    });
}

async function cargarContenido() {
    // Aquí es donde sucede la magia: Sincronizamos con el canal público
    // sin necesidad de GramJS ni login.
    console.log("📥 Sincronizando vídeos de Telegram...");
    await fetchTelegramPublic("gran_player");
    cargar(); // Luego cargamos Firebase
}

async function fetchTelegramPublic(channelId) {
    try {
        const proxy = 'https://api.allorigins.win/get?url=';
        const url = `https://t.me/s/${channelId}`;
        const res = await fetch(proxy + encodeURIComponent(url));
        const data = await res.json();
        const html = data.contents;

        // Buscamos mensajes con vídeos o enlaces
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const messages = doc.querySelectorAll('.tgme_widget_message_wrap');

        messages.forEach(msg => {
            const text = msg.querySelector('.tgme_widget_message_text')?.innerText || "";
            const txtLower = text.toLowerCase();

            let cat = "inicio";
            if (txtLower.includes("#pelicula")) cat = "peliculas";
            else if (txtLower.includes("#serie")) cat = "series";

            const titulo = text.split('\n')[0].replace(/#\w+/g, '').trim();
            const linkMatch = text.match(/https?:\/\/t\.me\/[^\s]+/);

            if (titulo && linkMatch && !base[cat].some(i => i.titulo === titulo)) {
                base[cat].push({
                    titulo: titulo,
                    link: linkMatch[0],
                    portada: "https://via.placeholder.com/160x230/111/f5c518?text=TV",
                    catAsignada: cat
                });
            }
        });
    } catch (e) { console.warn("Fallo al scrapear Telegram:", e); }
}

function render(modo) {
    filtroActual = modo;
    const container = document.getElementById('content');
    if (!container) return;
    container.innerHTML = '';

    const data = modo === 'inicio' ? base.peliculas.slice(0, 10) : base[modo];
    
    if (data.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#444; margin-top:50px;">No hay contenido disponible</div>';
        return;
    }

    const grid = document.createElement('div');
    grid.style = "display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 15px; padding: 10px;";
    
    data.forEach(item => {
        const card = document.createElement('div');
        card.className = "card";
        card.style = "background:#111; border-radius:10px; overflow:hidden; border:1px solid #222; cursor:pointer;";
        card.innerHTML = `
            <img src="${item.portada || 'https://via.placeholder.com/160x230/111/f5c518?text=VIDEO'}" style="width:100%; height:200px; object-fit:cover;">
            <div style="padding:10px; text-align:center; font-size:12px; font-weight:bold;">${item.titulo}</div>
        `;
        card.onclick = () => reproducir(item.titulo, item.link);
        grid.appendChild(card);
    });
    container.appendChild(grid);
}

async function reproducir(titulo, url) {
    const player = document.getElementById('player-layer');
    const video = document.getElementById('main-video');
    player.style.display = 'flex';
    document.getElementById('video-info').innerText = titulo;

    if (url.includes('t.me/')) {
        const sUrl = url.replace("t.me/", "t.me/s/");
        const res = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(sUrl));
        const data = await res.json();
        const videoUrl = data.contents.match(/<video[^>]*src="([^"]*)"/)?.[1];

        if (videoUrl) {
            video.src = videoUrl;
            video.play();
        } else {
            alert("No se puede extraer el video directo de este mensaje.");
            player.style.display = 'none';
            window.open(url, '_blank');
        }
    } else {
        video.src = url;
        video.play();
    }
}

function cerrarReproductor() {
    const v = document.getElementById('main-video');
    v.pause(); v.src = "";
    document.getElementById('player-layer').style.display = 'none';
}
