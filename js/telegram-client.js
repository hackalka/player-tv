/**
 * MOTOR DE TELEGRAM (REVISIÓN MAESTRA - NO MORE ERRORS)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let client = null;

async function startEngine() {
    console.log("🚀 Arrancando motor...");

    // Verificación de librerías
    const lib = window.telegram || window.gramjs;

    if (!lib || !window.Buffer) {
        console.warn("⏳ Esperando componentes vitales...");
        setTimeout(startEngine, 500);
        return;
    }

    const { TelegramClient, sessions } = lib;
    const session = new sessions.StringSession(localStorage.getItem('tg_session') || "");

    client = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true
    });

    try {
        document.getElementById('boot-status').innerText = "CONECTANDO...";
        await client.connect();

        if (!await client.checkAuthorization()) {
            document.getElementById('loader-screen').style.display = 'none';
            document.getElementById('login-modal').style.display = 'flex';
            runQR();
        } else {
            onSuccess();
        }
    } catch (e) {
        console.error("Fallo de arranque:", e);
        document.getElementById('boot-status').innerText = "REINTENTANDO...";
        setTimeout(startEngine, 2000);
    }
}

async function runQR() {
    try {
        await client.signInUserWithQrCode({ apiId: API_ID, apiHash: API_HASH }, {
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
        onSuccess();
    } catch (e) {}
}

function onSuccess() {
    localStorage.setItem('tg_session', client.session.save());
    document.getElementById('loader-screen').style.display = 'none';
    document.getElementById('login-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
    if (typeof syncContents === 'function') syncContents();
}

window.addEventListener('load', startEngine);
