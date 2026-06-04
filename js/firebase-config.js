// URL de tu base de datos Firebase ofuscada
const _db = "aHR0cHM6Ly9wbGF5ZXJ0di05NDQ5Yy1kZWZhdWx0LXJ0ZGIuZXVyb3BlLXdlc3QxLmZpcmViYXNlZGF0YWJhc2UuYXBwLw==";

firebase.initializeApp({ databaseURL: atob(_db) });
const db = firebase.database();

// Sistema de Presencia (Usuarios Conectados)
const userRef = db.ref('conexiones').push();
const infoConectado = db.ref('.info/connected');

infoConectado.on('value', (snapshot) => {
    if (snapshot.val() === true) {
        userRef.onDisconnect().remove();
        userRef.set({
            nombre: navigator.platform,
            navegador: navigator.userAgent.includes("Chrome") ? "Chrome" : "Otro",
            ultimaVez: new Date().toLocaleTimeString()
        });
    }
});