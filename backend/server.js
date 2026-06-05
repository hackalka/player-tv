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
const TOPICS = {
    PELICULAS: 3185,
    SERIES: 1663,
    DEPORTES: 10583
};

(async () => {
    if (process.env.SESSION) {
        try {
            await client.connect();
            console.log("✅ Servidor conectado a Telegram");
        } catch (e) { console.error("Error conectando:", e); }
    }
})();

// Login robusto (mantenemos lo que ya funciona)
app.get("/login", async (req, res) => {
    try {
        await client.connect();
        const result = await client.sendCode({ apiId, apiHash }, req.query.phone);
        res.json({ hash: result.phoneCodeHash });
    } catch (e) { res.status(500).send(e.message); }
});

app.get("/verify", async (req, res) => {
    try {
        await client.start({
            phoneNumber: async () => req.query.phone,
            phoneCode: async () => req.query.code,
            password: async () => req.query.password || "",
            onError: (err) => { throw err; }
        });
        res.send(client.session.save());
    } catch (e) { res.status(500).send(e.message); }
});

// NUEVO: API CATÁLOGO POR TOPICS
app.get("/api/catalogo", async (req, res) => {
    try {
        const catalogo = { peliculas: [], series: [], deportes: [] };

        for (const [key, topicId] of Object.entries(TOPICS)) {
            const messages = await client.getMessages(CHANNEL_ID, {
                replyTo: topicId,
                limit: 40
            });

            messages.forEach(m => {
                if (!m.message) return;

                // Extraer título (primera línea)
                const titulo = m.message.split('\n')[0].replace(/#\w+/g, '').trim();

                // Buscar carátula (link de imagen en el texto)
                const posterMatch = m.message.match(/https?:\/\/.*\.(?:png|jpg|jpeg|webp)/i);

                catalogo[key.toLowerCase()].push({
                    id: m.id,
                    titulo: titulo,
                    sinopsis: m.message,
                    portada: posterMatch ? posterMatch[0] : null
                });
            });
        }
        res.json(catalogo);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get("/api/stream/:id", async (req, res) => {
    try {
        const messages = await client.getMessages(CHANNEL_ID, { ids: [parseInt(req.params.id)] });
        if (!messages.length || !messages[0].media) return res.status(404).send("No video");

        res.setHeader('Content-Type', 'video/mp4');
        await client.downloadMedia(messages[0].media, { outputFile: res, workers: 4 });
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Motor Netflix Pro listo`));
