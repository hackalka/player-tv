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

let globalCatalog = { peliculas: [], series: [], deportes: [] };

async function syncTelegram() {
    console.log("🔄 Sincronizando con Canal Privado...");
    try {
        const catalogo = { peliculas: [], series: {}, deportes: [] };
        const results = await Promise.all(Object.entries(TOPICS).map(async ([key, topicId]) => {
            const msgs = await client.getMessages(CHANNEL_ID, { replyTo: topicId, limit: 100 });
            return { key: key.toLowerCase(), msgs };
        }));

        results.forEach(resObj => {
            resObj.msgs.forEach(m => {
                if (!m.message && !m.media) return;

                const text = m.message || "";
                const lines = text.split('\n');
                const title = lines[0].trim();
                const root = title.split(/(\s\d+[xX]\d+|\s[sS]\d+|\s[tT]\d+|\sTEMPORADA|\sCAPITULO)/i)[0].trim();

                const item = {
                    id: m.id,
                    titulo: title,
                    sinopsis: lines.slice(1).filter(l => !l.includes('t.me/')).join(' ').trim(),
                    portada: m.media ? `/api/poster/${m.id}` : null,
                    links: []
                };

                // EXTRACCIÓN INTELIGENTE DE EPISODIOS
                lines.forEach(line => {
                    const linkMatch = line.match(/https?:\/\/t\.me\/(?:c\/)?[\d\w]+\/(\d+)\/(\d+)/) || line.match(/https?:\/\/t\.me\/(?:c\/)?[\d\w]+\/(\d+)/);
                    if (linkMatch) {
                        const msgId = linkMatch[linkMatch.length - 1];
                        // El label es el texto antes del link
                        let label = line.split('http')[0].replace(/[:\-]/g, '').trim();
                        if (!label) label = `VER CONTENIDO`;
                        item.links.push({ id: msgId, label: label });
                    }
                });

                if (m.media && !item.links.length) item.links.push({ id: m.id, label: "REPRODUCIR" });

                if (resObj.key === 'series') {
                    if (!catalogo.series[root]) catalogo.series[root] = { titulo: root, portada: item.portada, sinopsis: item.sinopsis, links: [] };
                    if (item.portada) catalogo.series[root].portada = item.portada;
                    item.links.forEach(l => catalogo.series[root].links.push(l));
                } else {
                    catalogo[resObj.key].push(item);
                }
            });
        });
        catalogo.series = Object.values(catalogo.series);
        globalCatalog = catalogo;
    } catch (e) { console.error(e); }
}

(async () => {
    if (process.env.SESSION) {
        await client.connect();
        await syncTelegram();
        setInterval(syncTelegram, 15 * 60 * 1000);
    }
})();

app.get("/api/catalogo", (req, res) => res.json(globalCatalog));

app.get("/api/poster/:id", async (req, res) => {
    try {
        const msgs = await client.getMessages(CHANNEL_ID, { ids: [parseInt(req.params.id)] });
        const buffer = await client.downloadMedia(msgs[0], { thumb: true });
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(buffer);
    } catch (e) { res.redirect('https://via.placeholder.com/200x300/111/f5c518?text=TV'); }
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
            res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': (end - start) + 1 });
            await client.downloadMedia(media, { outputFile: res, start: BigInt(start), end: BigInt(end), workers: 8 });
        } else {
            res.setHeader('Content-Length', size);
            await client.downloadMedia(media, { outputFile: res, workers: 8 });
        }
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Motor V12 Online"));
