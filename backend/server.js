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
        console.log("✅ Servidor Maestro Conectado");
    }
})();

// Función para limpiar nombres y agrupar series
function parseTitle(text) {
    const rawTitle = text.split('\n')[0].trim();
    // Detecta patrones como S01E01, Temporada 1, etc.
    const rootTitle = rawTitle.split(/ S\d+| T\d+| TEMPORADA| CAPITULO/i)[0].trim();
    return { full: rawTitle, root: rootTitle };
}

app.get("/api/catalogo", async (req, res) => {
    try {
        const catalogo = { peliculas: [], series: {}, deportes: [] };

        for (const [key, topicId] of Object.entries(TOPICS)) {
            const messages = await client.getMessages(CHANNEL_ID, { replyTo: topicId, limit: 100 });

            messages.forEach(m => {
                if (!m.message) return;
                const { full, root } = parseTitle(m.message);
                const sinopsis = m.message.split('\n').slice(1).join(' ').trim() || "Sin descripción disponible.";
                const hasPhoto = m.media && m.media.photo;
                const posterUrl = hasPhoto ? `/api/poster/${m.id}` : (m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i)?.[0] || null);

                const item = { id: m.id, titulo: full, sinopsis, portada: posterUrl };

                if (key === 'SERIES') {
                    if (!catalogo.series[root]) {
                        catalogo.series[root] = { titulo: root, portada: posterUrl, sinopsis, episodios: [] };
                    }
                    catalogo.series[root].episodios.push(item);
                } else {
                    catalogo[key.toLowerCase()].push(item);
                }
            });
        }
        // Convertir objeto de series a array
        catalogo.series = Object.values(catalogo.series);
        res.json(catalogo);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Endpoint para servir la foto de Telegram como carátula
app.get("/api/poster/:id", async (req, res) => {
    try {
        const msgs = await client.getMessages(CHANNEL_ID, { ids: [parseInt(req.params.id)] });
        if (msgs.length && msgs[0].media && msgs[0].media.photo) {
            const buffer = await client.downloadMedia(msgs[0].media.photo, {});
            res.setHeader('Content-Type', 'image/jpeg');
            res.send(buffer);
        } else { res.redirect('https://via.placeholder.com/200x300?text=NO+POSTER'); }
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
app.listen(PORT, () => console.log(`🚀 Motor Pro V3 Listo`));
