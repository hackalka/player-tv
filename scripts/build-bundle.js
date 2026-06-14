'use strict';
/**
 * Genera public/vendor/telegram.bundle.js: GramJS empaquetado para navegador,
 * con los polyfills de Node (Buffer/process/global) incluidos. Lo ejecuta
 * GitHub Actions (ver .github/workflows/build-telegram-bundle.yml).
 */
const fs = require('fs');
const esbuild = require('esbuild');

fs.mkdirSync('public/vendor', { recursive: true });

const entry = `
import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
if (!globalThis.process) globalThis.process = { env: {}, nextTick: function (f) { setTimeout(f, 0); }, version: '' };
if (!globalThis.global) globalThis.global = globalThis;
export * from 'telegram';
export * as sessions from 'telegram/sessions';
`;
fs.writeFileSync('entry.build.js', entry);

esbuild.build({
    entryPoints: ['entry.build.js'],
    bundle: true,
    format: 'iife',
    globalName: 'telegram',
    platform: 'browser',
    target: ['es2019'],
    define: { global: 'globalThis' },
    mainFields: ['browser', 'module', 'main'],
    minify: true,
    legalComments: 'none',
    outfile: 'public/vendor/telegram.bundle.js'
}).then(() => {
    const kb = Math.round(fs.statSync('public/vendor/telegram.bundle.js').size / 1024);
    console.log('✅ Bundle generado: public/vendor/telegram.bundle.js (' + kb + ' KB)');
}).catch((e) => { console.error('❌ Error de build:', e); process.exit(1); });
