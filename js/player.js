function registrarYVer(url, item) {
    // Guardar en historial
    let historial = JSON.parse(localStorage.getItem('historial_tv')) || [];
    const r = getRoot(item.titulo);
    historial = historial.filter(h => getRoot(h.titulo) !== r);
    historial.unshift(item);
    if (historial.length > 20) historial.pop();
    localStorage.setItem('historial_tv', JSON.stringify(historial));
    
    // Actualizar la interfaz de fondo
    if (typeof render === "function") render(filtroActual);

    // Lógica de apertura
    if (url.startsWith('acestream://')) {
        window.location.href = url;
    } else {
        mostrarSelector(url, item.titulo);
    }
}

function mostrarSelector(url, titulo) {
    const selector = document.getElementById('selector-modal');
    selector.classList.add('active');

    document.getElementById('btn-interno').onclick = () => {
        selector.classList.remove('active');
        cerrarModal(); 
        abrirPlayerInterno(url, titulo);
    };

    document.getElementById('btn-externo').onclick = () => {
        selector.classList.remove('active');
        window.open(url, '_blank');
    };
}

function abrirPlayerInterno(url, titulo) {
    const pContainer = document.getElementById('player-container');
    const iframe = document.getElementById('video-iframe');
    document.getElementById('player-title').textContent = titulo;
    
    iframe.src = url;
    pContainer.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Evita scroll
}

function cerrarPlayer() {
    const pContainer = document.getElementById('player-container');
    const iframe = document.getElementById('video-iframe');
    
    iframe.src = ''; 
    pContainer.style.display = 'none';
    document.body.style.overflow = 'auto';
}
