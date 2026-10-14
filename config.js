window.CONFIG = {
    // ===== Credenciales API de Telegram =====
    // Obtenidas en https://my.telegram.org (API development tools)
    apiId: 8952741,
    apiHash: '693fb2da124662dad85b2b337c53a386',

    // ===== Grupo / Foro de origen =====
    // ID del supergrupo foro (formato -100xxxxxxxxxx tal cual aparece en web.telegram.org)
    groupId: -1003924237464,

    // ===== Mapeo de TEMAS (topics) del foro -> categorías Netflix =====
    // El "id" es el ID del tema del foro (el número tras el "_" en la URL de web.telegram.org).
    //   Películas -> https://web.telegram.org/a/#-1003924237464_2  => id 2
    //   Series    -> https://web.telegram.org/a/#-1003924237464_4  => id 4
    //   Deportes  -> https://web.telegram.org/a/#-1003924237464_6  => id 6
    netflixTopics: [
        { id: 2, name: 'Películas', type: 'movie',  icon: '🎬' },
        { id: 4, name: 'Series',    type: 'series', icon: '📺' },
        { id: 6, name: 'Deportes',  type: 'sports', icon: '⚽' }
    ],

    // ===== Ajustes de la app =====
    appName: 'Player TV',
    defaultLanguage: 'es',

    // Mensajes a traer por tema (más = más contenido pero más lento al cargar)
    messagesPerTopic: 80,
    // Mensajes a traer por chat/tema en la vista estilo Telegram
    messagesPerChat: 60,

    // ===== Ajustes de UI =====
    heroAutoRotate: true,
    heroRotateInterval: 10000, // 10 segundos

    // Descargar miniaturas reales desde Telegram (más bonito pero más lento).
    // Si se desactiva, se usan placeholders de color.
    downloadThumbnails: true
};
