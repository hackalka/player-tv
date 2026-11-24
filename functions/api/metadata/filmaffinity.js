const FILMAFFINITY_HOSTS = new Set([
    'filmaffinity.com',
    'www.filmaffinity.com',
    'm.filmaffinity.com'
]);
const FILM_PATH = /^\/[a-z]{2}\/film\d+\.html$/i;
const MAX_HTML_BYTES = 1024 * 1024;
const UPSTREAM_HEADERS = {
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'es-ES,es;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
};

function json(data, status, cacheControl) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Cache-Control': cacheControl || 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff'
        }
    });
}

function validFilmPage(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return null;
    let url;
    try { url = new URL(rawUrl); } catch { return null; }
    if (url.protocol !== 'https:' || !FILMAFFINITY_HOSTS.has(url.hostname)
        || (url.port && url.port !== '443') || url.username || url.password
        || !FILM_PATH.test(url.pathname)) return null;
    return new URL(url.pathname, 'https://www.filmaffinity.com');
}

async function readHtml(response) {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
        throw new Error('FilmAffinity respondió con una página demasiado grande');
    }
    if (!response.body) return '';

    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_HTML_BYTES) {
            await reader.cancel();
            throw new Error('FilmAffinity respondió con una página demasiado grande');
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8').decode(bytes);
}

function decodeHtml(value) {
    const named = {
        amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: ' ',
        aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
        uuml: 'ü', ccedil: 'ç', iquest: '¿', iexcl: '¡', Aacute: 'Á', Eacute: 'É',
        Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü', Ccedil: 'Ç',
        hellip: '…'
    };
    return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, code) => {
        if (code[0] !== '#') return named[code] || entity;
        const numeric = code[1].toLowerCase() === 'x'
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
            ? String.fromCodePoint(numeric)
            : entity;
    });
}

function plainText(value) {
    return decodeHtml(String(value || '')
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

function getMetaContent(html, key, expectedValue) {
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of tags) {
        const attributes = {};
        const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
        let match;
        while ((match = attributePattern.exec(tag))) {
            attributes[match[1].toLowerCase()] = match[2] || match[3] || match[4] || '';
        }
        if (String(attributes[key] || '').toLowerCase() === expectedValue) {
            return decodeHtml(attributes.content || '');
        }
    }
    return '';
}

function synopsisFromMeta(value) {
    const match = String(value || '').match(/sinopsis\s*:\s*([\s\S]*)/i);
    if (!match) return '';
    return plainText(match[1]
        .replace(/(?:\.{3}|…)\s*(?:puedes ver|disponible en)[\s\S]*$/i, '')
        .replace(/(?:\.{3}|…)\s*$/i, ''));
}

export function parseFilmAffinityPage(html) {
    const source = String(html || '');
    const description = getMetaContent(source, 'name', 'description')
        || getMetaContent(source, 'property', 'og:description');
    const synopsisTag = source.match(/<dd\b(?=[^>]*\bitemprop\s*=\s*(?:"description"|'description'|description))[^>]*>([\s\S]*?)<\/dd>/i);
    const titleTag = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title = plainText(getMetaContent(source, 'property', 'og:title')
        || (titleTag && titleTag[1])).replace(/\s*-\s*FilmAffinity\s*$/i, '');
    const image = getMetaContent(source, 'property', 'og:image');
    let poster = '';
    try {
        const imageUrl = new URL(image);
        if (imageUrl.protocol === 'https:' && imageUrl.hostname === 'pics.filmaffinity.com') {
            poster = imageUrl.href;
        }
    } catch { }
    const synopsis = (synopsisTag && plainText(synopsisTag[1])) || synopsisFromMeta(description);
    const year = ((title + ' ' + description).match(/\b(?:19|20)\d{2}\b/) || [])[0] || '';
    return { source: 'FilmAffinity', title, description: synopsis, year, poster };
}

export async function onRequest({ request }) {
    if (request.method !== 'GET') {
        return json({ error: 'Método no permitido' }, 405, 'no-store');
    }
    const upstreamUrl = validFilmPage(new URL(request.url).searchParams.get('url'));
    if (!upstreamUrl) {
        return json({ error: 'Se requiere una URL válida de una ficha de FilmAffinity' }, 400, 'no-store');
    }

    let response;
    try {
        response = await fetch(upstreamUrl, {
            headers: UPSTREAM_HEADERS,
            redirect: 'manual',
            cf: { cacheTtl: 86400 }
        });
    } catch (error) {
        console.warn('[metadata] FilmAffinity no responde:', error.message);
        return json({ error: 'No se pudo consultar FilmAffinity' }, 502, 'no-store');
    }
    if (!response.ok) {
        console.warn('[metadata] FilmAffinity respondió:', response.status);
        return json({ error: 'FilmAffinity respondió con un error', status: response.status }, 502, 'no-store');
    }

    let html;
    try { html = await readHtml(response); }
    catch (error) {
        console.warn('[metadata] No se pudo leer la ficha de FilmAffinity:', error.message);
        return json({ error: 'La ficha de FilmAffinity no se pudo leer' }, 502, 'no-store');
    }
    return json(parseFilmAffinityPage(html), 200, 'public, max-age=86400, s-maxage=86400');
}
