const { TelegramClient, Api } = window.telegram;
const { StringSession } = window.telegram.sessions;

const apiId = 8952741;
const apiHash = "693fb2da124662dad85b2b337c53a386";
const stringSession = new StringSession(localStorage.getItem('tg_session') || "");

const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

let loginResolver;
let step = 'phone'; // phone, code, 2fa

async function conectarTelegram() {
    if (!localStorage.getItem('tg_session')) {
        document.getElementById('login-modal').style.display = 'flex';

        await client.start({
            phoneNumber: async () => {
                step = 'phone';
                return new Promise(resolve => { loginResolver = resolve; });
            },
            phoneCode: async () => {
                step = 'code';
                actualizarUI();
                return new Promise(resolve => { loginResolver = resolve; });
            },
            password: async () => {
                step = '2fa';
                actualizarUI();
                return new Promise(resolve => { loginResolver = resolve; });
            },
            onError: (err) => console.log(err),
        });

        localStorage.setItem('tg_session', client.session.save());
        document.getElementById('login-modal').style.display = 'none';
        actualizarDesdeTelegram();
    } else {
        await client.connect();
        actualizarDesdeTelegram();
    }
}

function actualizarUI() {
    if (step === 'code') {
        document.getElementById('phone-input').style.display = 'none';
        document.getElementById('code-input').style.display = 'block';
        document.getElementById('login-msg').innerText = "Introduce el código recibido";
    } else if (step === '2fa') {
        document.getElementById('code-input').style.display = 'none';
        document.getElementById('2fa-input').style.display = 'block';
        document.getElementById('login-msg').innerText = "Introduce tu contraseña de Verificación en 2 pasos";
    }
}

function iniciarLogin() {
    const val = step === 'phone' ? document.getElementById('phone-input').value :
                step === 'code' ? document.getElementById('code-input').value :
                document.getElementById('2fa-input').value;

    if (loginResolver) loginResolver(val);
}

// Escuchar eventos de Telegram para actualizar contenido en tiempo real
async function actualizarDesdeTelegram() {
    console.log("Conectado a Telegram");
    // Aquí puedes poner el ID de tu grupo
    const chatId = "gran_player";

    try {
        const fullChat = await client.invoke(new Api.channels.GetFullChannel({ channel: chatId }));
        console.log("Topics:", fullChat.fullChat.topics);
        // Aquí mapearías los topics a las categorías de tu web
    } catch (e) {
        console.error("Error cargando topics", e);
    }
}

window.onload = () => {
    conectarTelegram();
    if (typeof cargar === 'function') cargar();
};
