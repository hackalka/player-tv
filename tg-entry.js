// Punto de entrada del bundle de navegador (lo empaqueta webpack).
// Expone window.telegram con TelegramClient, Api y sessions (StringSession).
if (!globalThis.global) globalThis.global = globalThis;
export * from 'telegram';
export * as sessions from 'telegram/sessions';
