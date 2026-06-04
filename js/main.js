// ══════════════════════════════════════════
//  1. CONFIGURACIÓN Y VARIABLES
// ══════════════════════════════════════════
const tg = window.Telegram?.WebApp;

const _db = "aHR0cHM6Ly9wbGF5ZXJ0di05NDQ5Yy1kZWZhdWx0LXJ0ZGIuZXVyb3BlLXdlc3QxLmZpcmViYXNlZGF0YWJhc2UuYXBwLw==";
let db;

function initFirebase() {
    if (typeof firebase === 'undefined') {
        console.error("Firebase no cargado todavía...");
        setTimeout(initFirebase, 500);
        return;
    }
    firebase.initializeApp({ databaseURL: atob(_db) });
    db = firebase.database();
    cargar();
}

let base = { peliculas: [], series: [], directos: [], agenda: [], destacados: null };
let filtroActual = 'inicio';
let subFiltroActual = 'TODOS';
const IMG_CAMPO = "https://blog.marti.mx/wp-content/uploads/2023/06/campo_futbol_Header-770x449.webp";

// ══════════════════════════════════════════
//  2. CARGA DE DATOS
// ══════════════════════════════════════════
function cargar() {
    // Si queremos usar Telegram, podemos pausar Firebase o combinar ambos
    // Comentamos el window.onload original para que no choque con telegram-client.js
    // // window.onload = initFirebase;

    db.ref('destacado_manual').on('value', snap => {
        base.destacados = snap.val(); 
        render(filtroActual); 
    });

    ['peliculas', 'series', 'directos', 'agenda'].forEach(cat => {
        db.ref(cat).on('value', snap => {
            const data = snap.val() || {};
            let list = Object.keys(data).map(k => ({ ...data[k], firebaseKey: k, catAsignada: cat }));
            
            if (cat === 'peliculas') list.reverse(); 
            if (cat === 'agenda') list.sort((a, b) => obtenerValorCronologico(a.extra) - obtenerValorCronologico(b.extra));
            
            base[cat] = list;
            render(filtroActual);
        });
    });
}

// ══════════════════════════════════════════
//  3. LÓGICA DE FAVORITOS
// ══════════════════════════════════════════
function gestionarFavorito(item) {
    let favs = JSON.parse(localStorage.getItem('favoritos')) || [];
    const r = getRoot(item.titulo);
    const index = favs.findIndex(i => getRoot(i.titulo) === r);

    if (index > -1) {
        favs.splice(index, 1);
    } else {
        favs.push(item);
    }
    localStorage.setItem('favoritos', JSON.stringify(favs));
    
    // Actualizar visualmente el botón del modal si está abierto
    const btnModal = document.getElementById('btn-fav-modal');
    if (btnModal) {
        const esFav = favs.some(i => getRoot(i.titulo) === r);
        btnModal.style.color = esFav ? 'gold' : '#ccc';
        btnModal.innerHTML = `<i class="fa ${esFav ? 'fa-star' : 'fa-star-o'}"></i>`;
    }
    render(filtroActual);
}

function guardarSeguirViendo(item) {
    let lista = JSON.parse(localStorage.getItem('seguirViendo')) || [];
    lista = lista.filter(i => getRoot(i.titulo) !== getRoot(item.titulo));
    lista.unshift(item);
    if (lista.length > 20) lista.pop();
    localStorage.setItem('seguirViendo', JSON.stringify(lista));
}

function eliminarElemento(e, tituloRaiz, claveStorage) {
    e.stopPropagation();
    let lista = JSON.parse(localStorage.getItem(claveStorage)) || [];
    lista = lista.filter(i => getRoot(i.titulo) !== tituloRaiz);
    localStorage.setItem(claveStorage, JSON.stringify(lista));
    render(filtroActual);
}

// ══════════════════════════════════════════
//  4. RENDERIZADO PRINCIPAL
// ══════════════════════════════════════════
function render(modo) {
    filtroActual = modo;
    const container = document.getElementById('content');
    if (!container) return;

    container.innerHTML = '';
    
    // Banner Principal
    renderHero();

    if (modo === 'inicio') {
        const favs = JSON.parse(localStorage.getItem('favoritos')) || [];
        if (favs.length > 0) container.appendChild(crearSeccion("MIS FAVORITOS", favs, 'favoritos'));

        ['peliculas', 'series', 'directos', 'agenda'].forEach(cat => {
            if (base[cat]?.length > 0) {
                let t = cat === 'agenda' ? 'DEPORTES EN VIVO' : cat.toUpperCase();
                container.appendChild(crearSeccion(t, base[cat].slice(0, 20), null));
            }
        });
    } else {
        const grid = document.createElement('div');
        grid.className = "grid";
        
        let data = base[modo] || [];
        const visto = new Set();
        data.forEach(item => {
            if (!visto.has(item.titulo)) { visto.add(item.titulo); grid.appendChild(crearCard(item)); }
        });
        container.appendChild(grid);
    }
}

function crearSeccion(titulo, items, tipoStorage) {
    const sec = document.createElement('div');
    sec.style.marginBottom = "30px";
    sec.innerHTML = `<div class="section-title">${titulo}</div>`;

    const row = document.createElement('div');
    row.className = "row-container";
    
    const visto = new Set();
    items.forEach(item => {
        const r = getRoot(item.titulo);
        if (!visto.has(r)) { visto.add(r); row.appendChild(crearCard(item, tipoStorage)); }
    });
    sec.appendChild(row);
    return sec;
}

function crearCard(item, tipoStorage = null) {
    const card = document.createElement('div');
    card.className = "card";
    card.onclick = () => {
        if (typeof window.playVideo === 'function') {
            window.playVideo(item.titulo, item);
        } else {
            guardarSeguirViendo(item);
            abrirModal(item.titulo, item.catAsignada, item);
        }
    };

    const btnBorrar = tipoStorage ? `<div onclick="eliminarElemento(event, '${r}', '${tipoStorage}')" style="position:absolute; top:8px; right:8px; background:rgba(255,0,0,0.9); color:white; width:25px; height:25px; border-radius:50%; display:flex; align-items:center; justify-content:center; z-index:15; font-size:16px;">&times;</div>` : '';

    let contentHTML = '';
    if (item.logo1 && item.logo2) {
        contentHTML = `
            <div class="img-container">
                <div class="fondo-agenda">
                    <img class="escudo-mini" src="${item.logo1}">
                    <span class="vs-text">VS</span>
                    <img class="escudo-mini" src="${item.logo2}">
                </div>
            </div>`;
    } else {
        contentHTML = `
            <div class="img-container">
                <img class="portada ${item.catAsignada === 'directos' ? 'img-directo' : ''}" src="${item.portada || item.logo1}" onerror="this.src='https://via.placeholder.com/160x230/111/f5c518?text=${r}'">
            </div>`;
    }

    const infoExtra = item.extra ? `<div class="info-agenda">${item.extra}</div>` : '';

    card.innerHTML = `
        ${btnBorrar}
        ${contentHTML}
        <div class="info">
            <div class="info-titulo">${r}</div>
            ${infoExtra}
        </div>`;
    return card;
}

// ══════════════════════════════════════════
//  6. MODAL (CON ESTRELLA DE FAVORITOS)
// ══════════════════════════════════════════
function abrirModal(nombreRaiz, catKey, itemFallback) {
    if (tg) {
        tg.BackButton.show();
        tg.BackButton.onClick(() => cerrarModal());
    }
    const modal = document.getElementById('modal');
    modal.classList.add('active');
    
    let lista = [];
    ['agenda', 'peliculas', 'series', 'directos'].forEach(c => {
        const matches = base[c].filter(i => getRoot(i.titulo) === nombreRaiz);
        if (matches.length > 0) lista = [...lista, ...matches];
    });
    if (lista.length === 0) lista = [itemFallback];

    const principal = lista[0];
    const favs = JSON.parse(localStorage.getItem('favoritos')) || [];
    const esFav = favs.some(i => getRoot(i.titulo) === nombreRaiz);

    // Actualizamos el título y añadimos la estrella al lado
    document.getElementById('det-titulo').innerHTML = `${nombreRaiz} <span id="btn-fav-modal" style="margin-left:15px; cursor:pointer; color:${esFav?'gold':'#ccc'}; font-size:24px;"><i class="fa ${esFav?'fa-star':'fa-star-o'}"></i></span>`;
    
    document.getElementById('btn-fav-modal').onclick = () => gestionarFavorito(principal);
    document.getElementById('det-sinopsis').textContent = principal.sinopsis || "Sin descripción.";

    const header = document.getElementById('modalHeader');
    if (principal.logo1 && principal.logo2) {
        header.innerHTML = `<div style="background-image:url('${IMG_CAMPO}'); background-size:cover; height:200px; display:flex; align-items:center; justify-content:center; gap:20px;">
            <img src="${principal.logo1}" style="height:90px; filter:drop-shadow(0 0 10px white);"><b style="font-size:25px; color:white;">VS</b><img src="${principal.logo2}" style="height:90px; filter:drop-shadow(0 0 10px white);">
        </div>`;
    } else {
        header.innerHTML = `<div style="background-image: linear-gradient(transparent, #000), url('${principal.portada || principal.logo1}'); height:280px; background-size:cover; background-position:center;"></div>`;
    }

    const tabs = document.getElementById('tabsTemporadas');
    tabs.innerHTML = '';
    
    if (catKey === 'series') {
        const temps = {};
        lista.forEach(i => {
            const sMatch = i.titulo.match(/S(\d+)/i);
            const sNum = sMatch ? sMatch[1] : "01";
            if (!temps[sNum]) temps[sNum] = [];
            temps[sNum].push(i);
        });
        Object.keys(temps).sort().forEach((s, idx) => {
            const b = document.createElement('button');
            b.className = `tab-temp ${idx === 0 ? 'active' : ''}`;
            b.textContent = `TEMP ${s}`;
            b.onclick = () => {
                document.querySelectorAll('.tab-temp').forEach(btn => btn.classList.remove('active'));
                b.classList.add('active');
                mostrarCaps(temps[s], true);
            };
            tabs.appendChild(b);
        });
        mostrarCaps(temps[Object.keys(temps).sort()[0]], true);
    } else {
        mostrarCaps(lista, false);
    }
}

function mostrarCaps(items, esSerie) {
    const box = document.getElementById('linksBox');
    box.innerHTML = '';
    
    if (esSerie) {
        items.sort((a, b) => {
            const numA = parseInt(a.titulo.match(/E(\d+)/i)?.[1] || 0);
            const numB = parseInt(b.titulo.match(/E(\d+)/i)?.[1] || 0);
            return numA - numB;
        });
    }

    items.forEach(item => {
        let label = item.titulo;
        if (esSerie) {
            const eMatch = item.titulo.match(/E(\d+)/i);
            label = eMatch ? `CAPÍTULO ${parseInt(eMatch[1])}` : item.titulo;
        }

        const links = [
            { u: item.link, n: 'LINK 1' },
            { u: item.link1, n: 'LINK 2' },
            { u: item.acestream, n: 'ACESTREAM' },
            { u: item.id, n: 'ID ACESTREAM' }
        ];

        links.forEach(l => {
            if (l.u && l.u.length > 5) {
                const row = document.createElement('div');
                row.style = "background:rgba(255,255,255,0.05); margin-bottom:8px; padding:12px; border-radius:10px; cursor:pointer; display:flex; align-items:center; gap:12px; border:1px solid rgba(255,255,255,0.1);";
                const esAce = l.u.includes('acestream://') || l.u.length === 40;
                row.innerHTML = `<i class="fa ${esAce ? 'fa-bolt' : 'fa-play'}" style="color:gold;"></i>
                    <div style="color:white; flex:1;"><b style="font-size:13px;">${label}</b></div>`;
                row.onclick = () => {
                    let url = l.u;
                    if (l.u.length === 40 && !l.u.includes('://')) url = 'acestream://' + l.u;

                    if (tg && url.startsWith('http')) {
                        tg.openLink(url);
                    } else {
                        window.location.href = url;
                    }
                };
                box.appendChild(row);
            }
        });
    });
}

// ══════════════════════════════════════════
//  7. HERO Y UTILIDADES
// ══════════════════════════════════════════
function renderHero() {
    const hero = document.getElementById('hero-container');
    if (!hero || filtroActual !== 'inicio' || !base.destacados) { if(hero) hero.style.display='none'; return; }
    hero.style.display = 'block';
    const item = base.destacados;
    const r = getRoot(item.titulo);
    
    if (item.logo1 && item.logo2) {
        hero.innerHTML = `
        <div class="hero-content" style="background-image:linear-gradient(rgba(0,0,0,0.4), var(--bg)), url('${IMG_CAMPO}');">
            <div class="hero-details">
                <div class="hero-vs-box">
                    <img src="${item.logo1}">
                    <span>VS</span>
                    <img src="${item.logo2}">
                </div>
                <h2>${r}</h2>
                <button class="btn-play-hero" onclick="abrirModal('${r}','${item.catAsignada}',null)">
                    <i class="fa fa-play"></i> VER AHORA
                </button>
            </div>
        </div>`;
    } else {
        hero.innerHTML = `
        <div class="hero-content" style="background-image:linear-gradient(transparent, var(--bg)), url('${item.portada || item.logo1}');">
            <div class="hero-details">
                <h2>${r}</h2>
                <button class="btn-play-hero" onclick="abrirModal('${r}','${item.catAsignada}',null)">
                    <i class="fa fa-play"></i> VER AHORA
                </button>
            </div>
        </div>`;
    }
}

function generarSubCategorias(modo) {
    const subNav = document.getElementById('sub-nav');
    const gens = ['TODOS', 'ACCION', 'DRAMA', 'TERROR', 'COMEDIA', 'ANIMACION', 'FANTASIA'];
    gens.forEach(g => {
        const b = document.createElement('button');
        b.style = `margin:5px; padding:8px 18px; border-radius:20px; border:none; cursor:pointer; background:${subFiltroActual===g?'gold':'#222'}; color:${subFiltroActual===g?'#000':'#fff'}; font-weight:bold;`;
        b.textContent = g;
        b.onclick = () => { subFiltroActual = g; render(modo); };
        subNav.appendChild(b);
    });
}

function cambiarFiltro(m, btn) {
    document.querySelectorAll('.f-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    subFiltroActual = 'TODOS';
    render(m);
}

function cerrarModal() {
    document.getElementById('modal').classList.remove('active');
    if (tg) tg.BackButton.hide();
}
function getRoot(t) { return t ? t.toUpperCase().split(/ S\d+| T\d+| TEMPORADA| CAPITULO| C\d+| E\d+/i)[0].trim() : ""; }
function obtenerValorCronologico(str) {
    const nums = str?.match(/\d+/g);
    return nums ? parseInt(nums[0])*100 + parseInt(nums[1]) : 999999;
}

// window.onload = initFirebase;
