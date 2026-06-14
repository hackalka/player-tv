'use strict';
/**
 * Servidor ESTÁTICO. En el modelo 100% cliente, toda la lógica de Telegram
 * corre en el navegador de cada usuario. Aquí solo servimos los archivos.
 */
const path = require('path');
const express = require('express');

const app = express();
app.disable('x-powered-by');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = parseInt(process.env.PORT || '3000', 10);

// El Service Worker debe servirse con alcance raíz
app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.path === '/sw.js') res.set('Service-Worker-Allowed', '/');
    next();
});

app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.listen(PORT, () => console.log('🚀 Tv Player (100% cliente) sirviendo en el puerto ' + PORT));
