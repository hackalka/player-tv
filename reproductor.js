// CONFIGURACIÓN FIREBASE
const _db = "aHR0cHM6Ly9wbGF5ZXJ0di05NDQ5Yy1kZWZhdWx0LXJ0ZGIuZXVyb3BlLXdlc3QxLmZpcmViYXNlZGF0YWJhc2UuYXBwLw==";
firebase.initializeApp({ databaseURL: atob(_db) });
const db = firebase.database();

let base = { peliculas: [], series: [], directos: [], agenda: [], destacados: null };
let filtroActual = 'inicio';

// CARGA DE DATOS CON TRY/CATCH
function cargarBase() {
    ['peliculas', 'series', 'directos', 'agenda'].forEach(cat => {
        db.ref(cat).on('value', snap => {
            try {
                const data = snap.val() || {};
                base[cat] = Object.values(data);
                
                // Quitar pantalla de carga cuando haya datos
                document.getElementById('loading-screen').style.display = 'none';
                render(filtroActual);
            } catch (e) {
                console.error("Error procesando Firebase: ", e);
            }
        });
    });
}

// CONTROL DE MANDO (OK y ATRÁS)
document.addEventListener('keydown', (e) => {
    const video = document.getElementById('main-video');
    const isPlayerOpen = document.getElementById('player-layer').classList.contains('active');

    if (isPlayerOpen) {
        if (e.key === 'Enter') { // Botón OK
            if (video.paused) video.play(); else video.pause();
        }
        if (e.key === 'Backspace' || e.key === 'Escape') { // Botón Atrás
            cerrarReproductor();
            e.preventDefault();
        }
    }
});

function registrarYVer(url, item) {
    if (url.startsWith('acestream://')) {
        window.location.href = url;
    } else {
        const player = document.getElementById('player-layer');
        const video = document.getElementById('main-video');
        player.classList.add('active');
        video.src = url;
        video.play();
    }
    
    // Guardar en historial con Try/Catch
    try {
        let hist = JSON.parse(localStorage.getItem('historial_tv') || '[]');
        hist = hist.filter(h => h.titulo !== item.titulo);
        hist.unshift(item);
        localStorage.setItem('historial_tv', JSON.stringify(hist.slice(0, 20)));
    } catch(e) { localStorage.clear(); }
}

function cerrarReproductor() {
    const video = document.getElementById('main-video');
    video.pause();
    video.src = "";
    document.getElementById('player-layer').classList.remove('active');
}

// Inicializar
window.onload = cargarBase;

// ... Aquí el resto de tus funciones: render(), abrirModal(), cambiarFiltro(), etc.
