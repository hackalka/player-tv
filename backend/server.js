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

let userPhone = "";
let phoneCode = "";
let userPassword = "";

(async () => {
    if (process.env.SESSION) {
        try {
            await client.connect();
            console.log("✅ Servidor conectado a Telegram");
        } catch (e) { console.error("Error conectando:", e); }
    }
})();

app.get("/login", async (req, res) => {
    userPhone = req.query.phone;
    if (!userPhone) return res.send("Falta el teléfono. Ejemplo: /login?phone=+34600000000");

    try {
        await client.connect();
        await client.sendCode({ apiId, apiHash }, userPhone);
        res.send("✅ Código enviado a Telegram. Ahora ve a /verify?code=TU_CODIGO");
    } catch (e) { res.send("Error: " + e.message); }
});

app.get("/verify", async (req, res) => {
    phoneCode = req.query.code;
    userPassword = req.query.password || ""; // Opcional si tienes 2FA

    if (!phoneCode) return res.send("Falta el código. Ejemplo: /verify?code=12345");

    try {
        // USAMOS START: Es el método más robusto que existe
        await client.start({
            phoneNumber: async () => userPhone,
            phoneCode: async () => phoneCode,
            password: async () => userPassword,
            onError: (err) => { throw err; }
        });

        const sessionString = client.session.save();
        res.send(`
            <div style="background:#000; color:#fff; padding:40px; font-family:sans-serif; text-align:center;">
                <h1 style="color:#22c55e;">¡CONECTADO CON ÉXITO!</h1>
                <p>Copia este código y pégalo en Render (SESSION):</p>
                <textarea style="width:100%; height:150px; background:#111; color:#22c55e; border:1px solid #333; padding:10px;">${sessionString}</textarea>
            </div>
        `);
    } catch (e) {
        if (e.message.includes("SESSION_PASSWORD_NEEDED") && !userPassword) {
            res.send("⚠️ REQUIERE 2FA. Añade la contraseña a la URL: /verify?code=" + phoneCode + "&password=TU_PASS");
        } else {
            res.send("Error: " + e.message);
        }
    }
});

// API CATÁLOGO Y STREAM (Lo mismo de antes, funciona perfecto)
app.get("/api/catalogo", async (req, res) => {
    try {
        const entity = await client.getEntity("gran_player");
        const messages = await client.getMessages(entity, { limit: 100 });
        const catalogo = messages.filter(m => m.media).map(m => {
            return {
                id: m.id,
                titulo: m.message?.split('\n')[0].replace(/#\w+/g, '').trim() || "Sin título",
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
        res.setHeader('Content-Type', 'video/mp4');
        await client.downloadMedia(messages[0].media, { outputFile: res, workers: 4 });
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 API lista en puerto ${PORT}`));
