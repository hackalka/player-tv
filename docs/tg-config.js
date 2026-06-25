/* ===================================================================
 * Configuracion del cliente (version 100% navegador, sin servidor).
 * Cada usuario inicia sesion con SU cuenta de Telegram; la conexion va
 * directa navegador -> Telegram (MTProto sobre WebSocket).
 * =================================================================== */
window.TVP_CONFIG = {
    // Credenciales de la API de Telegram (https://my.telegram.org)
    apiId: 8952741,
    apiHash: '693fb2da124662dad85b2b337c53a386',

    // Grupo/foro principal de origen del catalogo
    groupId: '-1003924237464',

    // ===== PROPIETARIO (admin de la app) =====
    // Solo el propietario ve el "Gestor personal" (panel completo de Telegram).
    // Pon AQUI tu ID numerico de Telegram o tu @usuario (sin @).
    // Si lo dejas vacio, la app entra en modo "configuracion": el panel se muestra
    // a quien entre, y arriba veras tu ID/usuario para copiarlo aqui y bloquear el resto.
    ownerId: '898353177',          // ej: '898353177'
    ownerUsername: 'ck_alka',    // ej: 'ck_alka' (sin @)

    appName: 'TV+',

    // Enlaces "tvgram://" del catalogo se abriran en esta app Android.
    // Si conoces el nombre EXACTO del paquete de TVGram Player, ponlo aqui
    // (ej: 'com.tvgram.player'); asi Android abrira esa app directamente y, si
    // no esta instalada, ofrecera el Play Store. Dejalo vacio para que Android
    // muestre el selector de apps que soportan el esquema tvgram://.
    tvgramPackage: 'com.network.tvgramplayer.playstore',

    // Mensajes a traer por tema. 50000 cubre cualquier grupo real (Telegram
    // pagina internamente, pero la carga inicial es proporcional al numero).
    messagesPerTopic: 50000,

    // Etiqueta(s) que debe tener el TITULO de un tema para mostrarse
    autoTags: ['playertv:auto', 'tvplayer:auto', 'tvgram:auto'],

    // TMDB (v4 token recomendado o v3 key). Se usa desde el navegador.
    tmdbKey: 'cbb1fa07c88626f5c57d56e48d8ce704',
    tmdbToken: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJjYmIxZmEwN2M4ODYyNmY1YzU3ZDU2ZTQ4ZDhjZTcwNCIsIm5iZiI6MTc3MTc3OTI0OS43NDMsInN1YiI6IjY5OWIzNGIxMjE0MTY1ZDNmNGIyOGY1NiIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.PPzm5Z0TpX6EhkaeVpi-Nhzy1tMvjpcMOKbAy16R3fc',

    // ===== FIREBASE (sincronizacion en la nube: favoritos, "continuar viendo",
    //        carátulas/sinopsis compartidas entre TODOS los dispositivos) =====
    // Pega aqui la config REAL de tu proyecto Firebase. La consigues en:
    //   https://console.firebase.google.com  ->  tu proyecto  ->  ⚙ Configuracion
    //   del proyecto  ->  pestaña "General"  ->  "Tus apps"  ->  app Web  ->
    //   "Configuracion del SDK" -> "Config". Copia los valores aqui.
    // Tambien crea una base de datos "Firestore" (modo produccion) y en Reglas
    // permite lectura/escritura (ver instrucciones que te paso).
    // Si lo dejas en blanco, la app funciona igual pero SIN sincronizar en la nube.
    firebase: {
        apiKey: '',              // ej: 'AIzaSyB....'
        authDomain: '',          // ej: 'tuproyecto.firebaseapp.com'
        projectId: '',           // ej: 'tuproyecto'
        storageBucket: '',       // ej: 'tuproyecto.appspot.com'
        messagingSenderId: '',   // ej: '1234567890'
        appId: ''                // ej: '1:1234567890:web:abc123'
    }
};
