/**
 * MOTOR DE TELEGRAM (INYECTOR MAESTRO)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let client = null;

async function startLogin() {
    console.log("⚡ Iniciando conexión...");

    // Forzamos Buffer por si acaso
    if (typeof window.Buffer === 'undefined' && window.buffer) {
        window.Buffer = window.buffer.Buffer;
    }

    const lib = window.telegram || window.gramjs;
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
            finalize();
        }
    } catch (e) {
        console.error(e);
        document.getElementById('boot-status').innerText = "ERROR DE CONEXIÓN. REFRESCA.";
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
        finalize();
    } catch (e) {}
}

function finalize() {
    localStorage.setItem('tg_session', client.session.save());
    document.getElementById('loader-screen').style.display = 'none';
    document.getElementById('login-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
    if (typeof syncContents === 'function') syncContents();
}

// El inyector de index.html llamará a esta función al terminar
window.iniciarTodo = startLogin;
// Iniciamos automáticamente tras un pequeño delay para asegurar estabilidad
setTimeout(startLogin, 500);
