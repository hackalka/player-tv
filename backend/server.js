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
    console.log("🔄 Sincronizando contenidos directos de Telegram...");
    try {
        const catalogo = { peliculas: [], series: [], deportes: [] };
        for (const [key, topicId] of Object.entries(TOPICS)) {
            const msgs = await client.getMessages(CHANNEL_ID, { replyTo: topicId, limit: 100 });
            msgs.forEach(m => {
                if (!m.media) return;
                const text = m.message || "";
                const lines = text.split('\n');
                const title = lines[0].trim();
                const item = { id: m.id, titulo: title, sinopsis: "", portada: `/api/poster/${m.id}`, links: [] };

                const sinopsisLines = [];
                lines.forEach(line => {
                    const linkMatch = line.match(/https?:\/\/t\.me\/(?:c\/)?[\d\w]+\/(\d+)\/(\d+)/) || line.match(/https?:\/\/t\.me\/(?:c\/)?[\d\w]+\/(\d+)/);
                    if (linkMatch) {
                        const msgId = linkMatch[linkMatch.length - 1];
                        let label = line.split('http')[0].replace(/[:\-]/g, '').trim();
                        if (!label) label = `OPCIÓN ${item.links.length + 1}`;
                        item.links.push({ id: msgId, label: label });
                    } else if (line.trim() && !line.includes('t.me') && line.trim() !== title) {
                        sinopsisLines.push(line.trim());
                    }
                });

                item.sinopsis = sinopsisLines.join(' ');
                if ((m.media.document || m.media.video) && item.links.length === 0) {
                    item.links.push({ id: m.id, label: "REPRODUCIR DIRECTO" });
                }
                if (item.links.length > 0) catalogo[key.toLowerCase()].push(item);
            });
        }
        globalCatalog = catalogo;
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
        if (msgs.length && msgs[0].media) {
            const buffer = await client.downloadMedia(msgs[0], { thumb: true });
            if (buffer) {
                res.setHeader('Content-Type', 'image/jpeg');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                return res.send(buffer);
            }
        }
        res.redirect('https://via.placeholder.com/200x300/111/f5c518?text=NO+IMAGE');
    } catch (e) { res.status(500).send(e.message); }
});

// MOTOR DE STREAMING DEFINITIVO (COMPATIBLE CON EXOPLAYER, VLC Y WEB)
app.get("/api/stream/:id", async (req, res) => {
    try {
        const msgId = parseInt(req.params.id);
        const msgs = await client.getMessages(CHANNEL_ID, { ids: [msgId] });

        if (!msgs.length || !msgs[0].media) {
            // Si no está en el canal principal, lo buscamos en todo Telegram (por si es un link /c/)
            return res.status(404).send("Media no encontrada");
        }

        const media = msgs[0].media;
        const document = media.document || media.video;
        if (!document) return res.status(400).send("No es un archivo de video");

        const size = document.size;
        const mime = document.mimeType || 'video/mp4';

        // Cabeceras cruciales para que ExoPlayer y el Navegador no fallen
        res.setHeader('Content-Type', mime);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', `inline; filename="video.${mime.split('/')[1]}"`);

        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : size - 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Content-Length': (end - start) + 1,
            });

            await client.downloadMedia(media, {
                outputFile: res,
                start: BigInt(start),
                end: BigInt(end),
                workers: 16 // Máxima velocidad de bombeo
            });
        } else {
            res.setHeader('Content-Length', size);
            await client.downloadMedia(media, { outputFile: res, workers: 16 });
        }
    } catch (e) {
        console.error("Stream error:", e);
        res.status(500).send(e.message);
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Motor de Streaming Pro V14 Listo"));
