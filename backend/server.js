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

const CHANNEL_ID = "-1003749684388";
const TOPICS = { PELICULAS: 3185, SERIES: 1663, DEPORTES: 10583 };

// Caché de imágenes para velocidad extrema
const posterCache = new Map();

(async () => {
    if (process.env.SESSION) {
        await client.connect();
        console.log("🚀 Motor de Alta Velocidad Activo");
    }
})();

function parseMessage(m) {
    const lines = m.message ? m.message.split('\n') : ["Sin título"];
    const titleLine = lines[0].trim();
    const links = [];
    const urlRegex = /https?:\/\/t\.me\/[^\s]+/g;
    const matches = m.message ? m.message.match(urlRegex) : [];

    if (matches) {
        matches.forEach((url, index) => {
            const parts = url.split('/');
            const msgId = parts[parts.length - 1];
            links.push({ id: msgId, label: `OPCIÓN ${index + 1}` });
        });
    }

    if (m.media && !links.length) links.push({ id: m.id, label: "REPRODUCIR" });

    const sinopsis = lines.slice(1).filter(l => !l.includes('t.me/')).join(' ').trim();
    const hasPhoto = m.media && (m.media.photo || (m.media.document && m.media.document.thumbs));
    const posterUrl = hasPhoto ? `/api/poster/${m.id}` : null;

    return { id: m.id, titulo: titleLine, sinopsis: sinopsis || "Disfruta del contenido.", portada: posterUrl, links };
}

app.get("/api/catalogo", async (req, res) => {
    try {
        const catalogo = { peliculas: [], series: [], deportes: [] };

        // CARGA EN PARALELO (Promise.all): Mucho más rápido
        await Promise.all(Object.entries(TOPICS).map(async ([key, topicId]) => {
            const messages = await client.getMessages(CHANNEL_ID, { replyTo: topicId, limit: 50 });
            messages.forEach(m => {
                if (!m.message && !m.media) return;
                const data = parseMessage(m);
                if (data.portada || data.links.length > 0) {
                    catalogo[key.toLowerCase()].push(data);
                }
            });
        }));

        res.json(catalogo);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/poster/:id", async (req, res) => {
    const msgId = req.params.id;
    if (posterCache.has(msgId)) return res.send(posterCache.get(msgId));

    try {
        const msgs = await client.getMessages(CHANNEL_ID, { ids: [parseInt(msgId)] });
        if (msgs.length && msgs[0].media) {
            const buffer = await client.downloadMedia(msgs[0].media, { thumb: true });
            if (buffer) {
                res.setHeader('Content-Type', 'image/jpeg');
                posterCache.set(msgId, buffer); // Guardar en caché
                return res.send(buffer);
            }
        }
        res.redirect('https://via.placeholder.com/200x300?text=TV');
    } catch (e) { res.status(500).send(e.message); }
});

app.get("/api/stream/:id", async (req, res) => {
    try {
        const messages = await client.getMessages(CHANNEL_ID, { ids: [parseInt(req.params.id)] });
        if (!messages.length || !messages[0].media) return res.status(404).send("No video");

        const media = messages[0].media;
        const size = media.document ? media.document.size : (media.video ? media.video.size : 0);

        // SOPORTE DE RANGO (Range): Permite saltar en el video y carga instantánea
        const range = req.headers.range;
        if (range && size) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
            const chunksize = (end - start) + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/mp4',
            });

            await client.downloadMedia(media, {
                outputFile: res,
                start: BigInt(start),
                end: BigInt(end),
                workers: 4
            });
        } else {
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Length', size);
            await client.downloadMedia(media, { outputFile: res, workers: 4 });
        }
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Motor Turbo V5 Listo`));
