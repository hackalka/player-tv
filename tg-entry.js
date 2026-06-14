// Punto de entrada del bundle de navegador (lo empaqueta webpack).
// En CommonJS porque package.json tiene "type": "commonjs".
// Expone window.telegram con TelegramClient, Api, sessions y bigInt (misma copia que usa GramJS).
if (!globalThis.global) globalThis.global = globalThis;
const telegram = require('telegram');
telegram.sessions = require('telegram/sessions');
telegram.bigInt = require('big-integer'); // misma instancia interna -> offsets de streaming correctos
module.exports = telegram;
