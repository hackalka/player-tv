const FILMAFFINITY_HOSTS = new Set([
    'filmaffinity.com',
    'www.filmaffinity.com',
    'm.filmaffinity.com'
]);
const FILM_PATH = /^\/[a-z]{2}\/film\d+\.html$/i;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const UPSTREAM_HEADERS = {
    Accept: 'text/plain',
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

async function readResponseText(response) {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        throw new Error('La respuesta de metadatos es demasiado grande');
    }
    if (!response.body) return '';

    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error('La respuesta de metadatos es demasiado grande');
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

export function parseFilmAffinityReaderPage(text) {
    const source = String(text || '');
    const titleMatch = source.match(/^Title:\s*(.+)$/mi)
        || source.match(/^#\s+(.+)$/m);
    const title = plainText(titleMatch && titleMatch[1]);
    const synopsisMatch = source.match(/\bSinopsis\s+([\s\S]*?)\s*\(FILMAFFINITY\)/i);
    const synopsis = plainText((synopsisMatch && synopsisMatch[1] || '')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
    const imageMatch = source.match(/!\[[^\]]*\]\((https:\/\/pics\.filmaffinity\.com\/[^)\s]+)(?:\s+"[^"]*")?\)/i);
    const image = imageMatch && imageMatch[1];
    let poster = '';
    try {
        const imageUrl = new URL(image);
        if (imageUrl.protocol === 'https:' && imageUrl.hostname === 'pics.filmaffinity.com') {
            poster = imageUrl.href;
        }
    } catch { }
    const year = (title.match(/\b(?:19|20)\d{2}\b/) || [])[0] || '';
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
        response = await fetch(`https://r.jina.ai/${upstreamUrl.href}`, {
            headers: UPSTREAM_HEADERS,
            cf: { cacheTtl: 86400 }
        });
    } catch (error) {
        console.warn('[metadata] Jina Reader no responde:', error.message);
        return json({ error: 'No se pudo consultar la ficha de FilmAffinity' }, 502, 'no-store');
    }
    if (!response.ok) {
        console.warn('[metadata] Jina Reader respondió:', response.status);
        return json({ error: 'El intermediario no pudo consultar FilmAffinity', status: response.status }, 502, 'no-store');
    }

    let text;
    try { text = await readResponseText(response); }
    catch (error) {
        console.warn('[metadata] No se pudo leer la respuesta de Jina Reader:', error.message);
        return json({ error: 'La ficha de FilmAffinity no se pudo leer' }, 502, 'no-store');
    }
    const metadata = parseFilmAffinityReaderPage(text);
    if (!metadata.description) {
        console.warn('[metadata] Jina Reader no devolvió una sinopsis de FilmAffinity');
        return json({ error: 'No se encontró la sinopsis de FilmAffinity' }, 502, 'no-store');
    }
    return json(metadata, 200, 'public, max-age=86400, s-maxage=86400');
}
