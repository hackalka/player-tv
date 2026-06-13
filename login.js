'use strict';
/**
 * GENERADOR DE SESIÓN (ejecútalo UNA sola vez en tu ordenador)
 *
 *   1) npm install
 *   2) npm run login
 *   3) Escribe tu teléfono, el código que te llega por Telegram y, si tienes, tu 2FA.
 *   4) Copia la cadena larga que aparece y pégala en Railway como variable TG_SESSION.
 *
 * No subas esa cadena a GitHub: es tu sesión de Telegram.
 */
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const cfg = require('./server/config');

(async () => {
    console.log('\n=== Generador de sesión para Tv Player ===\n');
    const apiId = cfg.apiId;
    const apiHash = cfg.apiHash;
    const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });

    await client.start({
        phoneNumber: async () => await input.text('📱 Teléfono (con prefijo, ej +34...): '),
        phoneCode: async () => await input.text('🔑 Código recibido en Telegram: '),
        password: async () => await input.text('🔒 Contraseña 2FA (si no tienes, deja vacío): '),
        onError: (err) => console.log('Error:', err && err.message ? err.message : err)
    });

    const session = client.session.save();
    console.log('\n✅ ¡Sesión generada! Copia TODO lo de abajo y ponlo en Railway como TG_SESSION:\n');
    console.log('-------------------------------------------------------------');
    console.log(session);
    console.log('-------------------------------------------------------------\n');
    await client.disconnect();
    process.exit(0);
})();
