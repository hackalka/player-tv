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
let stringSession = new StringSession(process.env.SESSION || "");
let client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

let phoneCodeHash = "";
let userPhone = "";

(async () => {
    if (process.env.SESSION) {
        await client.connect();
        console.log("✅ Sesión cargada y conectada");
    }
})();

// --- PUERTA 1: SOLICITAR CÓDIGO ---
// Visita: https://tu-app.onrender.com/login?phone=+34600000000
app.get("/login", async (req, res) => {
    userPhone = req.query.phone;
    if (!userPhone) return res.send("Falta el teléfono. Ejemplo: /login?phone=+34600000000");

    try {
        await client.connect();
        const result = await client.sendCode({ apiId, apiHash }, userPhone);
        phoneCodeHash = result.phoneCodeHash;
        res.send("✅ Código enviado a Telegram. Ahora ve a /verify?code=TU_CODIGO");
    } catch (e) { res.send("Error: " + e.message); }
});

// --- PUERTA 2: VERIFICAR CÓDIGO ---
// Visita: https://tu-app.onrender.com/verify?code=12345
app.get("/verify", async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send("Falta el código. Ejemplo: /verify?code=12345");

    try {
        await client.signIn({
            phoneNumber: userPhone,
            phoneCodeHash: phoneCodeHash,
            phoneCode: code,
            onError: (err) => res.send("Error: " + err.message)
        });

        const sessionString = client.session.save();
        console.log("🚀 TU SESIÓN ES ESTA (CÓPIALA):", sessionString);
        res.send(`<h1>¡CONECTADO!</h1><p>Tu código de sesión es:</p><textarea style="width:100%;height:100px;">${sessionString}</textarea><br><br><b>Cópialo y ponlo en la variable SESSION de Render.</b>`);
    } catch (e) { res.send("Error: " + e.message); }
});

// Catálogo y Stream (lo que ya teníamos)
app.get("/api/catalogo", async (req, res) => {
    try {
        const entity = await client.getEntity("gran_player");
        const messages = await client.getMessages(entity, { limit: 100 });
        const catalogo = messages.filter(m => m.media).map(m => ({
            id: m.id,
            titulo: m.message?.split('\n')[0].replace(/#\w+/g, '').trim() || "Sin título",
            sinopsis: m.message || "",
            categoria: m.message?.toLowerCase().includes("#serie") ? "series" : "peliculas"
        }));
        res.json(catalogo);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/stream/:id", async (req, res) => {
    try {
        const entity = await client.getEntity("gran_player");
        const messages = await client.getMessages(entity, { ids: [parseInt(req.params.id)] });
        res.setHeader('Content-Type', 'video/mp4');
        await client.downloadMedia(messages[0].media, { outputFile: res, workers: 4 });
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor de Login listo en puerto ${PORT}`));
