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

    // TMDB: rellena sinopsis, año, nota, géneros y carátula buscando por el título.
    // Acepta v3 API Key (TMDB_KEY) o v4 Bearer token (TMDB_TOKEN).
    tmdbKey: (process.env.TMDB_KEY || 'cbb1fa07c88626f5c57d56e48d8ce704').trim(),
    tmdbToken: (process.env.TMDB_TOKEN || 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJjYmIxZmEwN2M4ODYyNmY1YzU3ZDU2ZTQ4ZDhjZTcwNCIsIm5iZiI6MTc3MTc3OTI0OS43NDMsInN1YiI6IjY5OWIzNGIxMjE0MTY1ZDNmNGIyOGY1NiIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.PPzm5Z0TpX6EhkaeVpi-Nhzy1tMvjpcMOKbAy16R3fc').trim(),

    // Carpeta de datos (sesiones de usuario persistidas + caché de miniaturas)
    dataDir: process.env.DATA_DIR || path.join(os.tmpdir(), 'tvp-data')
};
