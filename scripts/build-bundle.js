'use strict';
/**
 * Genera public/vendor/telegram.bundle.js: GramJS empaquetado para navegador.
 * - Polyfills de builtins de Node (crypto, stream, events, util, path, os, buffer…)
 * - Stub de paquetes solo-Node que en navegador no se usan (node-localstorage, socks…)
 * Lo ejecuta GitHub Actions (.github/workflows/build-telegram-bundle.yml).
 */
const fs = require('fs');
const esbuild = require('esbuild');
const { polyfillNode } = require('esbuild-plugin-polyfill-node');

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

// Paquetes solo-Node que el navegador no necesita (sesiones en disco, proxy socks, fs)
const STUBS = ['node-localstorage', 'write-file-atomic', 'graceful-fs', 'socks', 'mkdirp'];
const stubPlugin = {
    name: 'stub-node-only',
    setup(build) {
        build.onResolve({ filter: new RegExp('^(' + STUBS.join('|') + ')(/.*)?$') }, () => ({ path: 'stub', namespace: 'stub-ns' }));
        build.onLoad({ filter: /.*/, namespace: 'stub-ns' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
    }
};

esbuild.build({
    entryPoints: ['entry.build.js'],
    bundle: true,
    format: 'iife',
    globalName: 'telegram',
    platform: 'browser',
    target: ['es2020'],
    define: { global: 'globalThis' },
    mainFields: ['browser', 'module', 'main'],
    minify: true,
    legalComments: 'none',
    plugins: [stubPlugin, polyfillNode({ globals: { buffer: true, process: true } })],
    outfile: 'public/vendor/telegram.bundle.js'
}).then(() => {
    const kb = Math.round(fs.statSync('public/vendor/telegram.bundle.js').size / 1024);
    console.log('✅ Bundle generado: public/vendor/telegram.bundle.js (' + kb + ' KB)');
}).catch((e) => { console.error('❌ Error de build:', e); process.exit(1); });
