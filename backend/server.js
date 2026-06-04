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

const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

(async () => {
    console.log("Conectando con Telegram...");
    await client.connect();
    console.log("✅ Servidor conectado a Telegram");
})();

// Endpoint para el catálogo
app.get("/api/catalogo", async (req, res) => {
    try {
        const entity = await client.getEntity("gran_player");
        const fullChannel = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        const topics = fullChannel.fullChat.topics.topics || [];

        const catalogo = [];
        for (const topic of topics) {
            const messages = await client.getMessages(entity, { replyTo: topic.id, limit: 50 });
            messages.forEach(m => {
                if (!m.message) return;
                const texto = m.message.toLowerCase();
                let cat = "otros";
                if (texto.includes("#pelicula")) cat = "peliculas";
                else if (texto.includes("#serie")) cat = "series";

                catalogo.push({
                    id: m.id,
                    titulo: m.message.split('\n')[0].replace(/#\w+/g, '').trim(),
                    sinopsis: m.message,
                    categoria: cat,
                    topic: topic.title
                });
            });
        }
        res.json(catalogo);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Endpoint para streaming (Proxy de video)
app.get("/api/stream/:id", async (req, res) => {
    try {
        const entity = await client.getEntity("gran_player");
        const messages = await client.getMessages(entity, { ids: [parseInt(req.params.id)] });
        const media = messages[0].media;

        res.setHeader('Content-Type', 'video/mp4');
        await client.downloadMedia(media, {
            outputFile: res, // Enviamos el video directamente al navegador
            workers: 4
        });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API Netflix lista en puerto ${PORT}`));
