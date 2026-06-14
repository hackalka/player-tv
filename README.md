# Tv Player

Catálogo estilo **Netflix** sobre un **grupo de Telegram**, **100% en el navegador**:
cada usuario entra con **su propia cuenta** (teléfono + 2FA) y el vídeo va **directo de
Telegram a su dispositivo**, usando **su ancho de banda y su caché**. El servidor solo
sirve archivos estáticos (no procesa vídeo).

- **Vista Cine (Netflix):** temas con la etiqueta configurada (películas, series, deportes…).
- **Vista Chat (Telegram):** solo para **administradores del grupo** (editar / borrar).
- **Login por usuario** dentro de la web (sin bots, sin servidor de sesiones).

## Cómo funciona

- El navegador carga **GramJS** y se conecta directamente a Telegram (MTProto sobre WSS).
- La sesión de cada usuario se guarda en su navegador (`localStorage`).
- El streaming de vídeo se sirve mediante un **Service Worker** que pide los bytes por rangos
  a Telegram a través de la cuenta del usuario.
- "Admin" = quien sea **administrador/creador** del grupo en Telegram (automático).

## Configuración

Toda la config de cliente está en **`public/config.js`**:

```js
window.CONFIG = {
  apiId: 8952741,
  apiHash: '....',
  groupId: -1003749684388,
  appName: 'Tv Player',
  autoTags: ['playertv:auto', 'tvplayer:auto'],
  messagesPerTopic: 80
};
```

El servidor solo usa `PORT` (lo inyecta Railway).

## Desplegar

```bash
npm install
npm start            # sirve public/ en http://localhost:3000 (o el PORT de Railway)
```

Al ser estático, también vale cualquier hosting estático (Railway, Netlify, GitHub Pages…),
pero **debe ser HTTPS o localhost** para que funcione el Service Worker (streaming).

## Estructura

```
server/index.js     Servidor estático (solo sirve public/)
public/
  index.html        UI
  config.js         Configuración de cliente (Telegram + grupo + etiqueta)
  tg-engine.js      Motor de Telegram en el navegador (login, catálogo, streaming)
  sw.js             Service Worker de streaming por rangos
  script.js         Interfaz (catálogo, detalle, chat admin, TV, favoritos…)
  style.css
```

## Funciones

- Login por usuario (teléfono → código → 2FA), sesión guardada en el navegador.
- Detalle estilo Netflix (póster, sinopsis, metadatos, botón Ver) y series por capítulos.
- Series en un post con enlaces `t.me`, multi-enlace (DAZN 1/2/3), AceStream, `.mp4` directo.
- **Continuar viendo** (con ✕ para quitar), **Mi lista**, **Novedades** y **buscador con filtros**.
- **Chat admin** (editar/borrar) solo para administradores del grupo.
- Navegación con **mando de TV Box**.

## Notas / límites

- **TV Box:** este modelo exige más al dispositivo (el navegador hace MTProto + streaming).
  En cajas muy básicas puede ir lento o entrecortado.
- **mkv/avi:** no se reproducen en el navegador; se ofrece **descargar** el archivo.
- Las credenciales `apiId/apiHash` quedan visibles en el navegador (es un cliente; usa unas dedicadas).
- Cada usuario debe poder **acceder al grupo** (y a los canales de los enlaces `t.me`).
