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
    groupId: '-1003749684388',

    // ===== PROPIETARIO (admin de la app) =====
    // Solo el propietario ve el "Gestor personal" (panel completo de Telegram).
    // Pon AQUI tu ID numerico de Telegram o tu @usuario (sin @).
    // Si lo dejas vacio, la app entra en modo "configuracion": el panel se muestra
    // a quien entre, y arriba veras tu ID/usuario para copiarlo aqui y bloquear el resto.
    ownerId: '',          // ej: '898353177'
    ownerUsername: '',    // ej: 'ck_alka' (sin @)

    appName: 'Tv Player',

    // Mensajes a traer por tema
    messagesPerTopic: 300,

    // Etiqueta(s) que debe tener el TITULO de un tema para mostrarse
    autoTags: ['playertv:auto', 'tvplayer:auto'],

    // TMDB (v4 token recomendado o v3 key). Se usa desde el navegador.
    tmdbKey: 'cbb1fa07c88626f5c57d56e48d8ce704',
    tmdbToken: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJjYmIxZmEwN2M4ODYyNmY1YzU3ZDU2ZTQ4ZDhjZTcwNCIsIm5iZiI6MTc3MTc3OTI0OS43NDMsInN1YiI6IjY5OWIzNGIxMjE0MTY1ZDNmNGIyOGY1NiIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.PPzm5Z0TpX6EhkaeVpi-Nhzy1tMvjpcMOKbAy16R3fc'
};
