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

// Caché de catálogo
let globalCatalog = { peliculas: [], series: [], deportes: [] };

async function syncTelegram() {
    console.log("🔄 Sincronizando: 1 Imagen = 1 Ficha de Netflix...");
    try {
        const catalogo = { peliculas: [], series: [], deportes: [] };

        for (const [key, topicId] of Object.entries(TOPICS)) {
            const msgs = await client.getMessages(CHANNEL_ID, { replyTo: topicId, limit: 100 });

            msgs.forEach(m => {
                // REGLA MAESTRA: Solo creamos ficha si el mensaje tiene IMAGEN o VIDEO (carátula)
                if (!m.media) return;

                const text = m.message || "";
                const lines = text.split('\n');
                const title = lines[0].trim();

                const item = {
                    id: m.id,
                    titulo: title,
                    sinopsis: "",
                    portada: `/api/poster/${m.id}`,
                    links: []
                };

                // Extraer sinopsis y links numerados
                const sinopsisLines = [];
                lines.slice(1).forEach(line => {
                    const linkMatch = line.match(/https?:\/\/t\.me\/(?:c\/)?[\d\w]+\/(\d+)\/(\d+)/) || line.match(/https?:\/\/t\.me\/(?:c\/)?[\d\w]+\/(\d+)/);
                    if (linkMatch) {
                        const msgId = linkMatch[linkMatch.length - 1];
                        let label = line.split('http')[0].trim();
                        // Si no tiene nombre el link, le ponemos número
                        if (!label) label = `Enlace ${item.links.length + 1}`;
                        item.links.push({ id: msgId, label: label });
                    } else if (line.trim() && !line.includes('t.me')) {
                        sinopsisLines.push(line.trim());
                    }
                });

                item.sinopsis = sinopsisLines.join(' ');

                // Si el mensaje es un video y no tenía links en el texto, él mismo es el video
                if ((m.media.document || m.media.video) && item.links.length === 0) {
                    item.links.push({ id: m.id, label: "REPRODUCIR VIDEO" });
                }

                catalogo[key.toLowerCase()].push(item);
            });
        }
        globalCatalog = catalogo;
        console.log("✅ Catálogo Netflix V13 cargado");
    } catch (e) { console.error(e); }
}

(async () => {
    if (process.env.SESSION) {
        await client.connect();
        await syncTelegram();
        setInterval(syncTelegram, 10 * 60 * 1000);
    }
})();

app.get("/api/catalogo", (req, res) => res.json(globalCatalog));

app.get("/api/poster/:id", async (req, res) => {
    try {
        const msgs = await client.getMessages(CHANNEL_ID, { ids: [parseInt(req.params.id)] });
        const buffer = await client.downloadMedia(msgs[0], { thumb: true });
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(buffer);
    } catch (e) { res.redirect('https://via.placeholder.com/200x300/111/f5c518?text=PREVIEW'); }
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

app.listen(10000, () => console.log("🚀 Motor V13: Netflix Logic Online"));
