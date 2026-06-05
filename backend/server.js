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
        console.log("🚀 Motor Universal Pro V7 Online");
    }
})();

function parseMessage(m) {
    if (!m.message && !m.media) return null;

    const texto = m.message || "";
    const lines = texto.split('\n');
    const titleLine = lines[0].trim();
    const links = [];

    // 1. Buscar enlaces Acestream
    const aceMatch = texto.match(/acestream:\/\/[a-f0-9]{40}/i);
    if (aceMatch) {
        links.push({ url: aceMatch[0], label: "ACESTREAM", type: 'acestream' });
    }

    // 2. Buscar enlaces de Telegram o HTTP directos
    const urlRegex = /https?:\/\/[^\s]+/g;
    const matches = texto.match(urlRegex);
    if (matches) {
        matches.forEach((url, i) => {
            if (url.includes('t.me/')) {
                const parts = url.split('/');
                links.push({ id: parts[parts.length - 1], label: `LINK TELEGRAM ${i + 1}`, type: 'tg_ref' });
            } else {
                links.push({ url: url, label: `LINK WEB ${i + 1}`, type: 'direct' });
            }
        });
    }

    // 3. Si el mensaje es un video/documento, es el video principal
    if (m.media && (m.media.document || m.media.video)) {
        const doc = m.media.document || m.media.video;
        const fileName = doc.attributes?.find(a => a.fileName)?.fileName || "video.mp4";
        const ext = fileName.split('.').pop().toLowerCase();
        links.push({
            id: m.id,
            label: "ARCHIVO DIRECTO",
            type: 'tg_file',
            ext: ext,
            isBrowserNative: ['mp4', 'webm', 'mov'].includes(ext)
        });
    }

    const sinopsis = lines.slice(1).filter(l => !l.includes('http') && !l.includes('acestream')).join(' ').trim();
    const posterUrl = m.media ? `/api/poster/${m.id}` : null;

    return { id: m.id, titulo: titleLine, sinopsis: sinopsis || "Sin descripción.", portada: posterUrl, links };
}

app.get("/api/catalogo", async (req, res) => {
    try {
        const catalogo = { peliculas: [], series: [], deportes: [] };
        const results = await Promise.all(Object.entries(TOPICS).map(async ([key, topicId]) => {
            const msgs = await client.getMessages(CHANNEL_ID, { replyTo: topicId, limit: 60 });
            return { key: key.toLowerCase(), data: msgs.map(m => parseMessage(m)).filter(m => m !== null && (m.portada || m.links.length)) };
        }));
        results.forEach(r => { catalogo[r.key] = r.data; });
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
            // Intentar descargar la mejor imagen posible (foto completa o miniatura)
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
        const doc = media.document || media.video;
        const size = doc.size;

        res.setHeader('Accept-Ranges', 'bytes');
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${size}`,
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
app.listen(PORT, () => console.log(`🚀 Servidor Universal Pro v7`));
