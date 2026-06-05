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
        try {
            await client.connect();
            console.log("✅ Servidor conectado a Telegram");
        } catch (e) { console.error("Error conectando sesión:", e); }
    }
})();

app.get("/login", async (req, res) => {
    userPhone = req.query.phone;
    if (!userPhone) return res.send("Falta el teléfono. Ejemplo: /login?phone=+34600000000");

    try {
        await client.connect();
        const result = await client.sendCode({ apiId, apiHash }, userPhone);
        phoneCodeHash = result.phoneCodeHash;
        res.send("✅ Código enviado. Ahora ve a /verify?code=TU_CODIGO");
    } catch (e) { res.send("Error: " + e.message); }
});

app.get("/verify", async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send("Falta el código. Ejemplo: /verify?code=12345");

    try {
        await client.invoke(new Api.auth.SignIn({
            phoneNumber: userPhone,
            phoneCodeHash: phoneCodeHash,
            phoneCode: code
        }));

        const sessionString = client.session.save();
        res.send(`<h1>¡CONECTADO!</h1><p>Tu código de sesión es:</p><textarea style="width:100%;height:100px;">${sessionString}</textarea><br><br>Cópialo y ponlo en Render (SESSION).`);
    } catch (e) {
        if (e.message.includes("SESSION_PASSWORD_NEEDED")) {
            res.send("⚠️ Requiere 2FA. Ve a /2fa?password=TU_PASS");
        } else {
            res.send("Error: " + e.message);
        }
    }
});

app.get("/2fa", async (req, res) => {
    const password = req.query.password;
    try {
        await client.signIn({ password: async () => password });
        res.send(`<h1>¡2FA OK!</h1><textarea style="width:100%;height:100px;">${client.session.save()}</textarea>`);
    } catch (e) { res.send("Error 2FA: " + e.message); }
});

// API CATÁLOGO
app.get("/api/catalogo", async (req, res) => {
    try {
        const entity = await client.getEntity("gran_player");
        const messages = await client.getMessages(entity, { limit: 100 });
        const catalogo = messages.filter(m => m.media).map(m => {
            const lines = m.message?.split('\n') || ["Sin título"];
            return {
                id: m.id,
                titulo: lines[0].replace(/#\w+/g, '').trim(),
                sinopsis: m.message || "",
                categoria: m.message?.toLowerCase().includes("#serie") ? "series" : "peliculas"
            };
        });
        res.json(catalogo);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/stream/:id", async (req, res) => {
    try {
        const entity = await client.getEntity("gran_player");
        const messages = await client.getMessages(entity, { ids: [parseInt(req.params.id)] });
        if (!messages.length) return res.status(404).send("No encontrado");

        res.setHeader('Content-Type', 'video/mp4');
        await client.downloadMedia(messages[0].media, { outputFile: res, workers: 4 });
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 API lista en puerto ${PORT}`));
