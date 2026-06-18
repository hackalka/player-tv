window.CONFIG = {
    // Telegram API credentials
    apiId: 8952741,
    apiHash: '693fb2da124662dad85b2b337c53a386',
    channelId: 'gran_player',

    // ===== ADMIN / PROPIETARIO =====
    // Solo el propietario puede abrir el panel de administracion
    // (anadir grupos fuente y reenviar contenido). El resto de usuarios
    // solo ven el contenido en modo lectura.
    //
    // Pon AQUI tu ID numerico de Telegram o tu @usuario. Si lo dejas vacio,
    // la app entra en "modo configuracion": el panel se mostrara y arriba
    // veras tu ID/usuario para que lo copies aqui y bloquees el acceso al resto.
    ownerId: '',          // ej: 123456789
    ownerUsername: '',    // ej: 'miusuario' (sin @)

    // Grupo/canal destino por defecto al que se reenvia el contenido marcado.
    // Si lo dejas vacio se usa channelId ('gran_player').
    targetGroup: 'gran_player',

    // App settings
    appName: 'Player TV',
    defaultLanguage: 'es',

    // UI settings
    cardsPerRow: 6,
    heroAutoRotate: true,
    heroRotateInterval: 10000, // 10 segundos

    // Categories to display
    categories: [
        'Películas',
        'Series',
        'Documentales',
        'Deportes',
        'Música',
        'Infantil'
    ]
};
