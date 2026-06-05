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

(async () => {
    if (process.env.SESSION) {
        await client.connect();
        console.log("✅ Motor de Fichas Técnicas Activo");
    }
})();

function parseMessage(m) {
    const lines = m.message ? m.message.split('\n') : ["Sin título"];
    const titleLine = lines[0].trim();

    // Extraer enlaces del texto
    const links = [];
    const urlRegex = /https?:\/\/t\.me\/[^\s]+/g;
    const matches = m.message ? m.message.match(urlRegex) : [];

    if (matches) {
        matches.forEach((url, index) => {
            const parts = url.split('/');
            const msgId = parts[parts.length - 1];
            links.push({
                id: msgId,
                label: `OPCIÓN ${index + 1}`
            });
        });
    }

    // Si el mensaje mismo es un video y no tiene links en el texto
    if (m.media && !links.length) {
        links.push({ id: m.id, label: "REPRODUCIR" });
    }

    // Sinopsis: todas las líneas excepto la primera y los links
    const sinopsis = lines.slice(1).filter(l => !l.includes('t.me/')).join(' ').trim();

    // Portada
    const hasPhoto = m.media && (m.media.photo || (m.media.document && m.media.document.thumbs));
    const posterUrl = hasPhoto ? `/api/poster/${m.id}` : null;

    return {
        id: m.id,
        titulo: titleLine,
        sinopsis: sinopsis || "Disfruta de este contenido.",
        portada: posterUrl,
        links: links
    };
}

app.get("/api/catalogo", async (req, res) => {
    try {
        const catalogo = { peliculas: [], series: [], deportes: [] };

        for (const [key, topicId] of Object.entries(TOPICS)) {
            const messages = await client.getMessages(CHANNEL_ID, { replyTo: topicId, limit: 100 });

            messages.forEach(m => {
                if (!m.message && !m.media) return;
                const data = parseMessage(m);
                // Solo añadir si tiene portada o es un mensaje maestro
                if (data.portada || data.links.length > 0) {
                    catalogo[key.toLowerCase()].push(data);
                }
            });
        }
        res.json(catalogo);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/poster/:id", async (req, res) => {
    try {
        const msgs = await client.getMessages(CHANNEL_ID, { ids: [parseInt(req.params.id)] });
        if (msgs.length && msgs[0].media) {
            const buffer = await client.downloadMedia(msgs[0].media, { thumb: true });
            if (buffer) {
                res.setHeader('Content-Type', 'image/jpeg');
                return res.send(buffer);
            }
        }
        res.redirect('https://via.placeholder.com/200x300?text=SIN+POSTER');
    } catch (e) { res.status(500).send(e.message); }
});

app.get("/api/stream/:id", async (req, res) => {
    try {
        const messages = await client.getMessages(CHANNEL_ID, { ids: [parseInt(req.params.id)] });
        const media = messages[0].media;
        res.setHeader('Content-Type', 'video/mp4');
        await client.downloadMedia(media, { outputFile: res, workers: 4 });
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Motor V4: Fichas Maestras Listo`));
