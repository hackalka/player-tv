'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let functionModule;
async function loadFunction() {
    if (!functionModule) {
        const file = path.resolve(__dirname, '..', 'functions', 'api', 'metadata', 'filmaffinity.js');
        const source = fs.readFileSync(file, 'utf8');
        const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
        functionModule = await import(moduleUrl);
    }
    return functionModule;
}

test('parses FilmAffinity synopsis, poster and year from Jina Reader text', async () => {
    const { parseFilmAffinityReaderPage } = await loadFunction();
    const metadata = parseFilmAffinityReaderPage(`
Title: Shutter Island  (2010)
URL Source: https://m.filmaffinity.com/es/film173696.html

# Shutter Island
[![Image 24: Shutter Island ](https://pics.filmaffinity.com/shutter_island-982808260-mmed.jpg)](https://pics.filmaffinity.com/shutter_island-982808260-large.jpg "Shutter Island ")
Sinopsis En el verano de 1954, los agentes judiciales Teddy Daniels investigan la desaparición de una peligrosa asesina. (FILMAFFINITY)
    `);

    assert.deepEqual(metadata, {
        source: 'FilmAffinity',
        title: 'Shutter Island (2010)',
        description: 'En el verano de 1954, los agentes judiciales Teddy Daniels investigan la desaparición de una peligrosa asesina.',
        year: '2010',
        poster: 'https://pics.filmaffinity.com/shutter_island-982808260-mmed.jpg'
    });
});

test('proxies only validated FilmAffinity film pages through Jina Reader', async () => {
    const { onRequest } = await loadFunction();
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => {
        requests.push({ url: String(url), options });
        return new Response('Title: Película (2024)\nSinopsis Una historia. (FILMAFFINITY)', {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    };
    try {
        const target = 'https://m.filmaffinity.com/es/film173696.html';
        const request = new Request(
            'https://player-tv.pages.dev/api/metadata/filmaffinity?url=' + encodeURIComponent(target)
        );
        const response = await onRequest({ request });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'public, max-age=86400, s-maxage=86400');
        assert.equal((await response.json()).description, 'Una historia.');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, 'https://r.jina.ai/https://www.filmaffinity.com/es/film173696.html');
        assert.equal(requests[0].options.headers.Accept, 'text/plain');
    } finally {
        global.fetch = originalFetch;
    }

    const invalidRequest = new Request(
        'https://player-tv.pages.dev/api/metadata/filmaffinity?url=' +
        encodeURIComponent('https://example.com/es/film173696.html')
    );
    const invalidResponse = await onRequest({ request: invalidRequest });
    assert.equal(invalidResponse.status, 400);
    assert.equal(requests.length, 1);
});

test('rejects reader responses without a synopsis instead of caching empty metadata', async () => {
    const { onRequest } = await loadFunction();
    const originalFetch = global.fetch;
    global.fetch = async () => new Response('No readable synopsis', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
    try {
        const target = 'https://www.filmaffinity.com/es/film173696.html';
        const request = new Request(
            'https://player-tv.pages.dev/api/metadata/filmaffinity?url=' + encodeURIComponent(target)
        );
        const response = await onRequest({ request });
        assert.equal(response.status, 502);
        assert.equal(response.headers.get('cache-control'), 'no-store');
    } finally {
        global.fetch = originalFetch;
    }
});

test('rejects non-GET metadata requests', async () => {
    const { onRequest } = await loadFunction();
    const response = await onRequest({
        request: new Request('https://player-tv.pages.dev/api/metadata/filmaffinity', { method: 'POST' })
    });
    assert.equal(response.status, 405);
});
