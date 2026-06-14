'use strict';
/**
 * Empaqueta GramJS para navegador (window.telegram).
 * webpack respeta el "browser field" de GramJS (crypto/conexión de navegador)
 * y rellenamos los builtins de Node que falten. Lo ejecuta GitHub Actions.
 */
const path = require('path');
const webpack = require('webpack');

module.exports = {
    mode: 'production',
    entry: './build/entry.js',
    output: {
        path: path.resolve(__dirname, 'public/vendor'),
        filename: 'telegram.bundle.js',
        library: { name: 'telegram', type: 'umd' },
        globalObject: 'this'
    },
    performance: { hints: false },
    resolve: {
        fallback: {
            buffer: require.resolve('buffer/'),
            stream: require.resolve('stream-browserify'),
            crypto: require.resolve('crypto-browserify'),
            path: require.resolve('path-browserify'),
            os: require.resolve('os-browserify/browser'),
            zlib: require.resolve('browserify-zlib'),
            vm: require.resolve('vm-browserify'),
            assert: require.resolve('assert/'),
            util: require.resolve('util/'),
            constants: require.resolve('constants-browserify'),
            events: require.resolve('events/'),
            // builtins solo-Node que el navegador no necesita
            net: false, tls: false, fs: false, dns: false,
            http: false, https: false, http2: false,
            child_process: false, cluster: false, dgram: false,
            readline: false, repl: false, worker_threads: false, perf_hooks: false
        }
    },
    plugins: [
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
            process: 'process/browser'
        })
    ],
    stats: 'errors-warnings'
};
