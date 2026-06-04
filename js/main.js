/**
 * ENGINE MASTER: GITHUB PAGES EDITION (STABLE)
 */
let base = { peliculas: [], series: [], directos: [], agenda: [] };
let filtroActual = 'inicio';

// 1. Iniciador Global
window.startApp = function() {
    console.log("🚀 App iniciada");
    conectarBaseDatos();
};

// 2. Conectar con Firebase (v10 compatible)
function conectarBaseDatos() {
    if (!window.firebaseDB) {
        setTimeout(conectarBaseDatos, 500);
        return;
    }

    ['peliculas', 'series', 'directos', 'agenda'].forEach(cat => {
        const dbRef = window.firebaseRef(window.firebaseDB, cat);
        window.firebaseOnValue(dbRef, (snap) => {
            const data = snap.val() || {};
            base[cat] = Object.keys(data).map(k => ({ ...data[k], key: k, catAsignada: cat }));
            render(filtroActual);
        });
    });
}

// 3. UI: Filtros (ARREGLADO)
window.cambiarFiltro = function(f, btn) {
    console.log("Cambiando a:", f);
    filtroActual = f;

    // UI: Cambiar botón activo
    document.querySelectorAll('.f-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    render(f);
};

// 4. Pintar Contenido (Netflix Style)
function render(modo) {
    const container = document.getElementById('content');
    if (!container) return;
    container.innerHTML = '';

    const categorias = modo === 'inicio' ? ['peliculas', 'series', 'directos'] : [modo];

    categorias.forEach(cat => {
        if (base[cat] && base[cat].length > 0) {
            const section = document.createElement('div');
            section.innerHTML = `<h2 style="color:gold; margin:20px 10px 10px; font-size:18px;">${cat.toUpperCase()}</h2>`;

            const grid = document.createElement('div');
            grid.style = "display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 15px; padding: 10px;";

            base[cat].forEach(item => {
                const card = document.createElement('div');
                card.style = "background:#111; border-radius:12px; overflow:hidden; border:1px solid #222; cursor:pointer; position:relative;";
                card.innerHTML = `
                    <img src="${item.portada || 'https://via.placeholder.com/145x200/111/f5c518?text=TV'}" style="width:100%; height:190px; object-fit:cover;">
                    <div style="padding:10px; text-align:center; font-size:12px; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.titulo}</div>
                `;
                card.onclick = () => reproducir(item);
                grid.appendChild(card);
            });
            section.appendChild(grid);
            container.appendChild(section);
        }
    });

    if (container.innerHTML === '') {
        container.innerHTML = '<div style="text-align:center; color:#444; padding-top:50px;">No hay contenido en esta categoría</div>';
    }
}

// 5. Reproductor
function reproducir(item) {
    const layer = document.getElementById('player-layer');
    const video = document.getElementById('main-video');
    const info = document.getElementById('video-info');

    layer.style.display = 'flex';
    info.innerText = item.titulo;
    video.src = item.link;
    video.play().catch(e => {
        console.warn("Fallo reproducción directa, abriendo link...");
        window.open(item.link, '_blank');
        cerrarReproductor();
    });
}

window.cerrarReproductor = function() {
    const video = document.getElementById('main-video');
    video.pause();
    video.src = "";
    document.getElementById('player-layer').style.display = 'none';
};
