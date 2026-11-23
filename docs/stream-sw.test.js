'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createWorker() {
    const listeners = {};
    const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5]);
    const chunks = [];
    const client = {
        postMessage(message, ports) {
            let result;
            if (message.op === 'info') result = { size: bytes.length, mime: 'video/mp4' };
            else if (message.op === 'chunk') {
                chunks.push({ start: message.start, length: message.length });
                result = bytes.slice(message.start, message.start + message.length).buffer;
            }
            ports[0].postMessage(result);
        }
    };
    class TestMessageChannel {
        constructor() {
            this.port1 = { onmessage: null };
            this.port2 = {
                postMessage: data => this.port1.onmessage({ data })
            };
        }
    }

    const context = {
        self: {
            addEventListener: (name, callback) => { listeners[name] = callback; },
            skipWaiting() {},
            clients: {
                get: async () => client,
                matchAll: async () => [client],
                claim: async () => {}
            }
        },
        MessageChannel: TestMessageChannel,
        ArrayBuffer,
        Uint8Array,
        Response,
        ReadableStream,
        URL,
        setTimeout,
        clearTimeout
    };
    const source = fs.readFileSync(path.join(__dirname, 'stream-sw.js'), 'utf8');
    vm.runInNewContext(source, context);

    return {
        chunks,
        async fetch(range) {
            let responsePromise;
            const headers = new Headers();
            if (range) headers.set('Range', range);
            listeners.fetch({
                clientId: 'test',
                request: { url: 'https://example.test/tgstream/1/2', headers },
                respondWith: promise => { responsePromise = promise; }
            });
            return responsePromise;
        }
    };
}

test('streams a requested byte range with matching headers and bytes', async () => {
    const worker = createWorker();
    const response = await worker.fetch('bytes=1-3');

    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), 'bytes 1-3/6');
    assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [1, 2, 3]);
    assert.deepEqual(worker.chunks, [{ start: 1, length: 3 }]);
});

test('supports suffix ranges and rejects ranges beyond the file', async () => {
    const suffixWorker = createWorker();
    const suffix = await suffixWorker.fetch('bytes=-2');
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get('Content-Range'), 'bytes 4-5/6');
    assert.deepEqual(Array.from(new Uint8Array(await suffix.arrayBuffer())), [4, 5]);

    const invalidWorker = createWorker();
    const invalid = await invalidWorker.fetch('bytes=6-');
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('Content-Range'), 'bytes */6');
    assert.deepEqual(invalidWorker.chunks, []);
});
