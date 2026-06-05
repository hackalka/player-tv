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

const CHANNEL_ID = "-1003924237464";
const TOPICS = { PELICULAS: 2, SERIES: 4, DEPORTES: 6 };

// Caché ultra-rápida
const posterCache = new Map();

(async () => {
    if (process.env.SESSION) {
        await client.connect();
        console.log("🚀 Motor Pro V10 Estilo Cineflix Online");
    }
})();

// Limpieza de títulos y detección de series
function cleanTitle(text) {
    if (!text) return { title: "Sin título", root: "Sin título" };
    const firstLine = text.split('\n')[0].trim();
    const root = firstLine.split(/(\s\d+[xX]\d+|\s[sS]\d+|\s[tT]\d+|\sTEMPORADA|\sCAPITULO)/i)[0].trim();
    return { title: firstLine, root: root };
}

app.get("/api/catalogo", async (req, res) => {
    try {
        const catalogo = { peliculas: [], series: {}, deportes: [] };
        const results = await Promise.all(Object.entries(TOPICS).map(async ([key, topicId]) => {
            const msgs = await client.getMessages(CHANNEL_ID, { replyTo: topicId, limit: 100 });
            return { key: key.toLowerCase(), msgs };
        }));

        results.forEach(resObj => {
            resObj.msgs.forEach(m => {
                if (!m.message && !m.media) return;
                const { title, root } = cleanTitle(m.message);
                const sinopsis = m.message?.split('\n').slice(1).filter(l => !l.includes('http')).join(' ').trim() || "Sin descripción.";

                const item = {
                    id: m.id,
                    titulo: title,
                    sinopsis: sinopsis,
                    portada: m.media ? `/api/poster/${m.id}` : null,
                    links: []
                };

                // Extraer links de Telegram
                const matches = m.message?.match(/https?:\/\/t\.me\/[^\s]+/g);
                if (matches) {
                    matches.forEach((url, i) => {
                        const parts = url.split('/');
                        item.links.push({ id: parts[parts.length - 1], label: `OPCIÓN ${i + 1}` });
                    });
                }

                // Si el mensaje mismo es un video
                if (m.media && !item.links.length) {
                    item.links.push({ id: m.id, label: "REPRODUCIR" });
                }

                if (resObj.key === 'series') {
                    if (!catalogo.series[root]) {
                        catalogo.series[root] = { titulo: root, portada: item.portada, sinopsis: item.sinopsis, links: [] };
                    }
                    if (item.portada) catalogo.series[root].portada = item.portada;
                    item.links.forEach(l => {
                        l.label = item.titulo;
                        catalogo.series[root].links.push(l);
                    });
                } else {
                    catalogo[resObj.key].push(item);
                }
            });
        });
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
            // Bajamos solo la miniatura (muy rápido)
            const buffer = await client.downloadMedia(msgs[0].media, { thumb: true });
            if (buffer) {
                res.setHeader('Content-Type', 'image/jpeg');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                posterCache.set(msgId, buffer);
                return res.send(buffer);
            }
        }
        res.redirect('https://via.placeholder.com/200x300/111/f5c518?text=NO+IMAGE');
    } catch (e) { res.status(500).send(e.message); }
});

app.get("/api/stream/:id", async (req, res) => {
    try {
        const msgs = await client.getMessages(CHANNEL_ID, { ids: [parseInt(req.params.id)] });
        const media = msgs[0].media;
        const size = (media.document || media.video).size;

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');

        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Content-Length': (end - start) + 1,
            });
            await client.downloadMedia(media, { outputFile: res, start: BigInt(start), end: BigInt(end), workers: 8 });
        } else {
            res.setHeader('Content-Length', size);
            await client.downloadMedia(media, { outputFile: res, workers: 8 });
        }
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 API Netflix Edition Ready`));
