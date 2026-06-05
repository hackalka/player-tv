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

// CANAL Y TOPICS (Asegurando formato BigInt para evitar errores de ID)
const CHANNEL_ID = "-1003924237464";
const TOPICS = { PELICULAS: 2, SERIES: 4, DEPORTES: 6 };

const posterCache = new Map();

(async () => {
    if (process.env.SESSION) {
        await client.connect();
        console.log("✅ Motor Pro V9 Online");
    }
})();

function parseMessage(m) {
    if (!m.message && !m.media) return null;
    const text = m.message || "";
    const firstLine = text.split('\n')[0].trim();
    const cleanTitle = firstLine.split(/(\s\d+[xX]\d+|\s[sS]\d+|\s[tT]\d+|\sTEMPORADA|\sCAPITULO)/i)[0].trim();

    const links = [];
    const matches = text.match(/https?:\/\/t\.me\/[^\s]+/g);
    if (matches) {
        matches.forEach((url, i) => {
            const parts = url.split('/');
            links.push({ id: parts[parts.length - 1], label: `OPCIÓN ${i + 1}`, type: 'tg_ref' });
        });
    }

    if (m.media && (m.media.document || m.media.video)) {
        const doc = m.media.document || m.media.video;
        const fileName = doc.attributes?.find(a => a.fileName)?.fileName || "video.mp4";
        const ext = fileName.split('.').pop().toLowerCase();
        links.push({
            id: m.id,
            label: firstLine,
            type: 'tg_file',
            ext,
            isNative: ['mp4', 'webm'].includes(ext)
        });
    }

    return {
        id: m.id,
        titulo: firstLine,
        rootTitle: cleanTitle,
        sinopsis: text.split('\n').slice(1).filter(l => !l.includes('http')).join(' ').trim() || "Sin descripción.",
        portada: m.media ? `/api/poster/${m.id}` : null,
        links
    };
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
                const data = parseMessage(m);
                if (!data) return;
                if (resObj.key === 'series') {
                    if (!catalogo.series[data.rootTitle]) {
                        catalogo.series[data.rootTitle] = { titulo: data.rootTitle, portada: data.portada, sinopsis: data.sinopsis, links: [] };
                    }
                    if (data.portada) catalogo.series[data.rootTitle].portada = data.portada;
                    data.links.forEach(l => catalogo.series[data.rootTitle].links.push(l));
                } else {
                    catalogo[resObj.key].push(data);
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
            // Intentar descargar la imagen real del mensaje
            const buffer = await client.downloadMedia(msgs[0], { workers: 1 });
            if (buffer) {
                res.setHeader('Content-Type', 'image/jpeg');
                posterCache.set(msgId, buffer);
                return res.send(buffer);
            }
        }
        res.redirect('https://via.placeholder.com/200x300/111/f5c518?text=TV');
    } catch (e) { res.redirect('https://via.placeholder.com/200x300/111/f5c518?text=ERROR'); }
});

app.get("/api/stream/:id", async (req, res) => {
    try {
        const msgs = await client.getMessages(CHANNEL_ID, { ids: [parseInt(req.params.id)] });
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
app.listen(PORT, () => console.log(`🚀 Motor V9 Pro`));
