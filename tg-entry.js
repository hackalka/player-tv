// Punto de entrada del bundle de navegador (lo empaqueta webpack).
// En CommonJS porque package.json tiene "type": "commonjs".
// Expone window.telegram con TelegramClient, Api y sessions (StringSession).
if (!globalThis.global) globalThis.global = globalThis;
const telegram = require('telegram');
telegram.sessions = require('telegram/sessions');
module.exports = telegram;
