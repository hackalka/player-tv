/**
 * MOTOR DE TELEGRAM (VERSIÓN DIAGNÓSTICO MASTER)
 */

const API_ID = 8952741;
const API_HASH = "693fb2da124662dad85b2b337c53a386";

let client = null;
let retryCount = 0;

async function startBoot() {
    console.log("🚀 Verificando componentes...");

    // Intentamos rescatar Buffer si el navegador lo escondió
    if (typeof window.Buffer === 'undefined' && window.buffer) {
        window.Buffer = window.buffer.Buffer;
    }

    const lib = window.telegram || window.gramjs;
    const hasBuffer = typeof window.Buffer !== 'undefined';
    const hasLib = !!lib;

    if (!hasLib || !hasBuffer) {
        retryCount++;
        let missing = !hasLib ? "MOTOR TELEGRAM" : "SEGURIDAD (BUFFER)";
        document.getElementById('boot-status').innerText = `ESPERANDO ${missing}... (${retryCount})`;

        if (retryCount > 20) {
            document.getElementById('boot-status').innerHTML = "<span style='color:red;'>ERROR CRÍTICO: LIBRERÍAS BLOQUEADAS POR EL NAVEGADOR</span>";
            return;
        }

        setTimeout(startBoot, 500);
        return;
    }

    console.log("✅ Componentes listos. Iniciando sesión...");
    const { TelegramClient, sessions } = lib;
    const session = new sessions.StringSession(localStorage.getItem('tg_session') || "");

    client = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true
    });

    try {
        document.getElementById('boot-status').innerText = "ESTABLECIENDO CONEXIÓN...";
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
        document.getElementById('boot-status').innerText = "REINTENTANDO CONEXIÓN...";
        setTimeout(startBoot, 2000);
    }
}

async function runQR() {
    try {
        await client.signInUserWithQrCode({ apiId: API_ID, apiHash: API_HASH }, {
            qrCode: async (code) => {
                const url = `tg://login?token=${code.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
                const qr = qrcode(0, 'M');
                qr.addData(url);
                qr.make();
                document.getElementById('qr-loading').style.display = 'none';
                document.getElementById('qr-code').innerHTML = qr.createSvgTag({ cellSize: 4 });
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
    if (typeof syncContents === 'undefined') {
        // Si main.js no ha cargado funciones, las definimos o esperamos
        setTimeout(finalize, 500);
    } else {
        syncContents();
    }
}

// Iniciar proceso
window.addEventListener('load', startBoot);
