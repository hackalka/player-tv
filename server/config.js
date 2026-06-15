'use strict';
require('dotenv').config();
const os = require('os');
const path = require('path');

/**
 * Configuración del servidor Tv Player (modelo multi-usuario).
 * Cada usuario inicia sesión con su propia cuenta de Telegram; el servidor
 * mantiene un cliente por usuario. El grupo/temas son comunes para todos.
 */
module.exports = {
    // Credenciales de la API de Telegram (https://my.telegram.org) — compartidas por la app
    apiId: parseInt(process.env.TG_API_ID || '8952741', 10),
    apiHash: process.env.TG_API_HASH || '693fb2da124662dad85b2b337c53a386',

    // Grupo/foro de origen (formato -100xxxxxxxxxx o @usuario si es público)
    groupId: process.env.TG_GROUP_ID || '-1003749684388',

    // Marca
    appName: process.env.APP_NAME || 'Tv Player',

    // Puerto (Railway lo inyecta)
    port: parseInt(process.env.PORT || '3000', 10),

    // Mensajes a traer por tema
    messagesPerTopic: parseInt(process.env.MESSAGES_PER_TOPIC || '80', 10),

    // Etiqueta(s) que debe tener el título de un tema para mostrarse (separadas por coma)
    autoTags: (process.env.AUTO_TAG || 'playertv:auto,tvplayer:auto')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),

    // Carpeta de datos (sesiones de usuario persistidas + caché de miniaturas)
    dataDir: process.env.DATA_DIR || path.join(os.tmpdir(), 'tvp-data')
};
