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

    appName: 'TV+',

    // Enlaces "tvgram://" del catalogo se abriran en esta app Android.
    // Si conoces el nombre EXACTO del paquete de TVGram Player, ponlo aqui
    // (ej: 'com.tvgram.player'); asi Android abrira esa app directamente y, si
    // no esta instalada, ofrecera el Play Store. Dejalo vacio para que Android
    // muestre el selector de apps que soportan el esquema tvgram://.
    tvgramPackage: 'com.network.tvgramplayer.playstore',

    // Limite para las cargas completas solicitadas manualmente. El arranque
    // usa 100 y amplÃ­a a 500 por tema solo cuando el usuario estÃ¡ inactivo.
    messagesPerTopic: 1200,

    // Etiqueta(s) que debe tener el TITULO de un tema para mostrarse
    autoTags: ['playertv:auto', 'tvplayer:auto', 'tvgram:auto'],

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
