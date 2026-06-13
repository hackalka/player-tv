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

    // Grupo/foro de origen (formato -100xxxxxxxxxx o @usuario si es público)
    groupId: process.env.TG_GROUP_ID || '-1003749684388',

    // Marca de la app
    appName: process.env.APP_NAME || 'Tv Player',

    // Contraseña de administrador para ver el chat y editar/borrar contenido desde la web.
    // Si está vacía, el chat y la edición quedan DESACTIVADOS para todos.
    adminPassword: process.env.ADMIN_PASSWORD || '',

    // Puerto (Railway lo inyecta en PORT)
    port: parseInt(process.env.PORT || '3000', 10),

    // Cuántos mensajes traer por tema
    messagesPerTopic: parseInt(process.env.MESSAGES_PER_TOPIC || '80', 10),

    // ===== Auto-descubrimiento de temas =====
    // La web SOLO muestra los temas del foro cuyo título contenga una de estas etiquetas.
    // En la web se muestra el nombre del tema SIN la etiqueta.
    // Ej.: un tema titulado "Películas playertv:auto" se ve como "Películas".
    // Los temas que NO tengan la etiqueta no aparecen en ningún sitio de la web.
    // Se aceptan varias variantes por compatibilidad; configurable con AUTO_TAG (separadas por coma).
    autoTags: (process.env.AUTO_TAG || 'playertv:auto,tvplayer:auto')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
};
