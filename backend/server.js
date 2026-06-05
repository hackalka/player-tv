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

const posterCache = new Map();

(async () => {
    if (process.env.SESSION) {
        await client.connect();
        console.log("✅ Motor de Streaming Pro v6 Activo");
    }
})();

function parseMessage(m) {
    if (!m.message && !m.media) return null;

    const lines = m.message ? m.message.split('\n') : ["Sin título"];
    const titleLine = lines[0].trim();
    const links = [];

    // Extraer links de Telegram del texto
    const matches = m.message ? m.message.match(/https?:\/\/t\.me\/[^\s]+/g) : [];
    if (matches) {
        matches.forEach((url, i) => {
            const parts = url.split('/');
            links.push({ id: parts[parts.length - 1], label: `OPCIÓN ${i + 1}` });
        });
    }

    // Si el mensaje es un video y no tiene links, él mismo es el video
    if (m.media && (m.media.document || m.media.video) && !links.length) {
        links.push({ id: m.id, label: "REPRODUCIR" });
    }

    const sinopsis = lines.slice(1).filter(l => !l.includes('t.me/')).join(' ').trim();

    // Si tiene media, generamos URL de poster
    const posterUrl = m.media ? `/api/poster/${m.id}` : null;

    return { id: m.id, titulo: titleLine, sinopsis: sinopsis || "Disfruta del contenido.", portada: posterUrl, links };
}

app.get("/api/catalogo", async (req, res) => {
    try {
        const catalogo = { peliculas: [], series: [], deportes: [] };
        const results = await Promise.all(Object.entries(TOPICS).map(async ([key, topicId]) => {
            const msgs = await client.getMessages(CHANNEL_ID, { replyTo: topicId, limit: 60 });
            return { key: key.toLowerCase(), data: msgs.map(m => parseMessage(m)).filter(m => m !== null) };
        }));

        results.forEach(res => { catalogo[res.key] = res.data; });
        res.json(catalogo);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/poster/:id", async (req, res) => {
    const msgId = parseInt(req.params.id);
    if (posterCache.has(msgId)) return res.send(posterCache.get(msgId));

    try {
        const msgs = await client.getMessages(CHANNEL_ID, { ids: [msgId] });
        if (msgs.length && msgs[0].media) {
            // Descarga optimizada: intentamos miniatura primero para velocidad
            const buffer = await client.downloadMedia(msgs[0].media, { thumb: true });
            if (buffer) {
                res.setHeader('Content-Type', 'image/jpeg');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                posterCache.set(msgId, buffer);
                return res.send(buffer);
            }
        }
        res.redirect('https://via.placeholder.com/200x300/111/f5c518?text=PLAYER+TV');
    } catch (e) {
        res.redirect('https://via.placeholder.com/200x300/111/f5c518?text=ERROR');
    }
});

app.get("/api/stream/:id", async (req, res) => {
    try {
        const msgs = await client.getMessages(CHANNEL_ID, { ids: [parseInt(req.params.id)] });
        if (!msgs.length || !msgs[0].media) return res.status(404).send("No media");

        const media = msgs[0].media;
        const size = media.document ? media.document.size : (media.video ? media.video.size : (media.document?.size || 0));

        const range = req.headers.range;
        if (range && size) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : size - 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': (end - start) + 1,
                'Content-Type': 'video/mp4',
            });

            await client.downloadMedia(media, {
                outputFile: res,
                start: BigInt(start),
                end: BigInt(end),
                workers: 8 // Aumentamos workers para máxima velocidad
            });
        } else {
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Length', size);
            await client.downloadMedia(media, { outputFile: res, workers: 8 });
        }
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Motor v6 Pro Online`));
