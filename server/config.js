'use strict';
require('dotenv').config();

/**
 * Configuración del servidor Tv Player.
 * Todos los valores se pueden sobreescribir con variables de entorno en Railway.
 */
module.exports = {
    // Credenciales de la API de Telegram (https://my.telegram.org)
    apiId: parseInt(process.env.TG_API_ID || '8952741', 10),
    apiHash: process.env.TG_API_HASH || '693fb2da124662dad85b2b337c53a386',

    // Sesión de usuario generada UNA sola vez con `npm run login`.
    // Se pega en Railway como variable de entorno TG_SESSION.
    session: process.env.TG_SESSION || '',

    // Grupo/foro de origen (formato -100xxxxxxxxxx)
    groupId: process.env.TG_GROUP_ID || '-1003924237464',

    // Marca de la app
    appName: process.env.APP_NAME || 'Tv Player',

    // Puerto (Railway lo inyecta en PORT)
    port: parseInt(process.env.PORT || '3000', 10),

    // Cuántos mensajes traer por tema
    messagesPerTopic: parseInt(process.env.MESSAGES_PER_TOPIC || '80', 10),

    // Mapeo de TEMAS del foro -> categorías del catálogo.
    // El id es el número tras el "_" en la URL de web.telegram.org:
    //   Películas -> #-1003924237464_2  => 2
    //   Series    -> #-1003924237464_4  => 4
    //   Deportes  -> #-1003924237464_6  => 6
    topics: [
        { id: 2, name: 'Películas', type: 'movie',  icon: '🎬' },
        { id: 4, name: 'Series',    type: 'series', icon: '📺' },
        { id: 6, name: 'Deportes',  type: 'sports', icon: '⚽' }
    ]
};
