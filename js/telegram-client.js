/**
 * MOTOR DE TELEGRAM (REVISIÓN FINAL ESTILO CINEFLIX)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let tgClient = null;

async function bootSystem() {
    console.log("🚀 Iniciando secuencia de arranque...");

    // Diagnóstico de librerías
    const lib = window.telegram || window.gramjs;
    const hasBuffer = typeof window.Buffer !== 'undefined';
    const hasLib = !!lib;

    if (!hasLib || !hasBuffer) {
        let missing = !hasLib ? "MOTOR TELEGRAM" : "SEGURIDAD (BUFFER)";
        console.warn(`⏳ Falta: ${missing}. Reintentando...`);
        document.getElementById('boot-status').innerText = `ESPERANDO ${missing}...`;
        setTimeout(bootSystem, 500);
        return;
    }

    console.log("✅ Librerías listas. Conectando...");
    const { TelegramClient, sessions } = lib;
    const session = new sessions.StringSession(localStorage.getItem('tg_session') || "");

    tgClient = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true
    });

    try {
        document.getElementById('boot-status').innerText = "CONECTANDO CON TELEGRAM...";
        await tgClient.connect();

        if (!await tgClient.checkAuthorization()) {
            document.getElementById('loader-screen').style.display = 'none';
            document.getElementById('login-modal').style.display = 'flex';
            startQRLogin();
        } else {
            finalizeBoot();
        }
    } catch (e) {
        console.error("Error de arranque:", e);
        document.getElementById('boot-status').innerText = "ERROR DE CONEXIÓN. REINTENTANDO...";
        setTimeout(bootSystem, 2000);
    }
}

async function startQRLogin() {
    try {
        await tgClient.signInUserWithQrCode({ apiId: API_ID, apiHash: API_HASH }, {
            qrCode: async (code) => {
                const url = `tg://login?token=${code.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
                if (window.qrcode) {
                    const qr = qrcode(0, 'M');
                    qr.addData(url);
                    qr.make();
                    document.getElementById('qr-loading').style.display = 'none';
                    document.getElementById('qr-code').innerHTML = qr.createSvgTag({ cellSize: 4 });
                }
            }
        });
        finalizeBoot();
    } catch (e) {
        console.log("QR Flow reset");
    }
}

function finalizeBoot() {
    localStorage.setItem('tg_session', tgClient.session.save());
    document.getElementById('loader-screen').style.display = 'none';
    document.getElementById('login-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
    if (typeof syncContents === 'function') syncContents();
}

// Escuchar evento de carga
window.addEventListener('load', bootSystem);
