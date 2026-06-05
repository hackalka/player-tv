const express = require("express");
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const apiId = 8952741;
const apiHash = "693fb2da124662dad85b2b337c53a386";
const stringSession = new StringSession(process.env.SESSION || "");
const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

// NUEVO CANAL Y TOPICS
const CHANNEL_ID = "-1003924237464";
const TOPICS = {
    PELICULAS: 2,
    SERIES: 4,
    DEPORTES: 6
};

const posterCache = new Map();

(async () => {
    if (process.env.SESSION) {
        await client.connect();
        console.log("✅ Motor Pro V8 Online - Canal: " + CHANNEL_ID);
    }
})();

// Función Maestra de Detección de Títulos y Agrupación
function getRootTitle(text) {
    if (!text) return "Sin título";
    const firstLine = text.split('\n')[0].trim();
    // Regex para detectar: 1x02, S01E01, T1, Temporada 1, Capítulo 5, etc.
    // Cortamos el título justo antes de que empiecen estos patrones
    const cleanTitle = firstLine.split(/(\s\d+[xX]\d+|\s[sS]\d+|\s[tT]\d+|\sTEMPORADA|\sCAPITULO)/i)[0].trim();
    return { full: firstLine, root: cleanTitle };
}

function parseMessage(m) {
    if (!m.message && !m.media) return null;

    const texto = m.message || "";
    const { full, root } = getRootTitle(texto);
    const links = [];

    // Buscar links de Telegram
    const urlRegex = /https?:\/\/t\.me\/[^\s]+/g;
    const matches = texto.match(urlRegex);
    if (matches) {
        matches.forEach((url, i) => {
            const parts = url.split('/');
            links.push({ id: parts[parts.length - 1], label: `OPCIÓN ${i + 1}`, type: 'tg_ref' });
        });
    }

    // Si el mensaje es un video, es el video principal
    if (m.media && (m.media.document || m.media.video)) {
        const doc = m.media.document || m.media.video;
        const fileName = doc.attributes?.find(a => a.fileName)?.fileName || "video.mp4";
        const ext = fileName.split('.').pop().toLowerCase();
        links.push({
            id: m.id,
            label: full,
            type: 'tg_file',
            ext: ext,
            isBrowserNative: ['mp4', 'webm', 'mov'].includes(ext)
        });
    }

    const sinopsis = texto.split('\n').slice(1).filter(l => !l.includes('http')).join(' ').trim();
    const posterUrl = m.media ? `/api/poster/${m.id}` : null;

    return { id: m.id, titulo: full, rootTitle: root, sinopsis: sinopsis || "Sin descripción.", portada: posterUrl, links };
}

app.get("/api/catalogo", async (req, res) => {
    try {
        const catalogo = { peliculas: [], series: {}, deportes: [] };

        const results = await Promise.all(Object.entries(TOPICS).map(async ([key, topicId]) => {
            const msgs = await client.getMessages(CHANNEL_ID, { replyTo: topicId, limit: 100 });
            return { key: key.toLowerCase(), msgs: msgs };
        }));

        results.forEach(resObj => {
            resObj.msgs.forEach(m => {
                const data = parseMessage(m);
                if (!data) return;

                // Ignorar si no tiene ni portada ni enlaces
                if (!data.portada && !data.links.length) return;

                if (resObj.key === 'series') {
                    // AGRUPACIÓN INTELIGENTE DE SERIES
                    if (!catalogo.series[data.rootTitle]) {
                        catalogo.series[data.rootTitle] = {
                            titulo: data.rootTitle,
                            portada: data.portada,
                            sinopsis: data.sinopsis,
                            links: [] // Aquí meteremos todos los capítulos
                        };
                    }
                    // Si el mensaje actual tiene portada, la usamos como portada principal de la serie
                    if (data.portada) catalogo.series[data.rootTitle].portada = data.portada;

                    // Añadimos todos los links encontrados en este mensaje al contenedor de la serie
                    data.links.forEach(l => {
                        catalogo.series[data.rootTitle].links.push({
                            id: l.id,
                            label: l.label === "ARCHIVO DIRECTO" ? data.titulo : l.label,
                            type: l.type,
                            isBrowserNative: l.isBrowserNative
                        });
                    });
                } else {
                    catalogo[resObj.key].push(data);
                }
            });
        });

        // Convertir series de objeto a lista
        catalogo.series = Object.values(catalogo.series);
        res.json(catalogo);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/poster/:id", async (req, res) => {
    const msgId = parseInt(req.params.id);
    if (posterCache.has(msgId)) return res.send(posterCache.get(msgId));
    try {
        const msgs = await client.getMessages(CHANNEL_ID, { ids: [msgId] });
        if (msgs.length && msgs[0].media) {
            const media = msgs[0].media;
            const photo = media.photo || media.document?.thumbs?.[0] || media;
            const buffer = await client.downloadMedia(photo, {});
            if (buffer) {
                res.setHeader('Content-Type', 'image/jpeg');
                posterCache.set(msgId, buffer);
                return res.send(buffer);
            }
        }
        res.redirect('https://via.placeholder.com/200x300/111/f5c518?text=PREVIEW');
    } catch (e) { res.redirect('https://via.placeholder.com/200x300/111/f5c518?text=TV'); }
});

app.get("/api/stream/:id", async (req, res) => {
    try {
        const msgs = await client.getMessages(CHANNEL_ID, { ids: [parseInt(req.params.id)] });
        if (!msgs.length || !msgs[0].media) return res.status(404).send("No media");
        const media = msgs[0].media;
        const size = (media.document || media.video).size;
        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': (end - start) + 1,
                'Content-Type': 'video/mp4',
            });
            await client.downloadMedia(media, { outputFile: res, start: BigInt(start), end: BigInt(end), workers: 8 });
        } else {
            res.setHeader('Content-Length', size);
            res.setHeader('Content-Type', 'video/mp4');
            await client.downloadMedia(media, { outputFile: res, workers: 8 });
        }
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Motor V8: Multi-Grupo & Series Unificadas`));
