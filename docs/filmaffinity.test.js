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

test('parses FilmAffinity synopsis, poster and year from the page', async () => {
    const { parseFilmAffinityPage } = await loadFunction();
    const metadata = parseFilmAffinityPage(`
        <html><head>
            <title>Shutter Island (2010) - FilmAffinity</title>
            <meta property="og:title" content="Shutter Island (2010)">
            <meta property="og:image" content="https://pics.filmaffinity.com/shutter_island.jpg">
            <meta name="description" content="Sinopsis: Texto abreviado... Puedes ver la película">
        </head><body>
            <dl><dt>Sinopsis</dt><dd itemprop="description">En el verano de 1954, los agentes &quot;Teddy&quot; y Chuck investigan.</dd></dl>
        </body></html>
    `);

    assert.deepEqual(metadata, {
        source: 'FilmAffinity',
        title: 'Shutter Island (2010)',
        description: 'En el verano de 1954, los agentes "Teddy" y Chuck investigan.',
        year: '2010',
        poster: 'https://pics.filmaffinity.com/shutter_island.jpg'
    });
});

test('proxies only validated FilmAffinity film pages', async () => {
    const { onRequest } = await loadFunction();
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => {
        requests.push({ url: String(url), options });
        return new Response('<html><meta name="description" content="Sinopsis: Una historia."></html>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
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
        assert.equal(requests[0].url, 'https://www.filmaffinity.com/es/film173696.html');
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

test('rejects non-GET metadata requests', async () => {
    const { onRequest } = await loadFunction();
    const response = await onRequest({
        request: new Request('https://player-tv.pages.dev/api/metadata/filmaffinity', { method: 'POST' })
    });
    assert.equal(response.status, 405);
});
