# Tv Player

Catálogo estilo **Netflix** servido directamente desde tu **grupo de Telegram**.
A diferencia de una web estática, esta versión tiene **servidor (backend)**: la sesión de
Telegram vive en el servidor, así que **no hay pantalla de login en el navegador** y
**no se usa ningún bot**. Pensado para desplegar en **Railway** (o cualquier host de Node).

- **Vista Cine (Netflix):** los temas *Películas*, *Series* y *Deportes* del foro se muestran
  como catálogo (hero, filas, tarjetas con poster, reproductor con streaming por rangos).
- **Vista Chat (Telegram):** el resto de temas "off topic" se ven como un chat normal.
- **Marca:** "Tv Player" (configurable con `APP_NAME`).

## Arquitectura

```
server/
  index.js      Servidor Express: API + streaming de video por rangos + sirve el frontend
  telegram.js   Conexión con Telegram (GramJS) usando la sesión guardada
  config.js     Lee la configuración desde variables de entorno
public/
  index.html    Frontend (sin login, sin GramJS en el navegador)
  script.js     Consume /api/* y pinta el catálogo y el chat
  style.css     Estilos
login.js        Script que se ejecuta UNA vez para generar la sesión (TG_SESSION)
```

### API

| Endpoint                      | Descripción |
|-------------------------------|-------------|
| `GET /api/app`                | Marca y categorías. |
| `GET /api/catalog`            | Catálogo completo (categorías + items). |
| `GET /api/topics`             | Lista de temas del foro. |
| `GET /api/chat/:topicId`      | Mensajes de un tema (vista chat). |
| `GET /api/thumb/:topic/:msg`  | Miniatura/poster de un mensaje. |
| `GET /api/stream/:topic/:msg` | Streaming del video por rangos (`Range`). |
| `GET /api/health`             | Estado de la conexión. |

## Puesta en marcha

### 1) Generar la sesión (una sola vez, en tu ordenador)

```bash
npm install
npm run login
```

Introduce tu teléfono, el código que te llega por Telegram y (si tienes) tu contraseña 2FA.
Al final te imprime una **cadena larga**: esa es tu `TG_SESSION`.
**No la subas a GitHub.**

### 2) Desplegar en Railway

1. Sube este repo a GitHub y crea un proyecto en Railway desde el repo.
2. En **Variables**, añade:
   - `TG_API_ID` y `TG_API_HASH` (de https://my.telegram.org)
   - `TG_SESSION` = la cadena del paso 1
   - `TG_GROUP_ID` = `-1003924237464`
   - `APP_NAME` = `Tv Player`
3. Railway construye con Nixpacks y arranca con `npm start`. La web queda lista **sin login**.

### 3) Local (opcional)

```bash
cp .env.example .env   # rellena TG_SESSION
npm install
npm start              # http://localhost:3000
```

## Configurar los temas

Los temas se mapean en `server/config.js`. El `id` es el número que aparece tras el `_`
en la URL de Telegram Web, por ejemplo `https://web.telegram.org/a/#-1003924237464_2` → tema **2**.

```js
topics: [
    { id: 2, name: 'Películas', type: 'movie',  icon: '🎬' },
    { id: 4, name: 'Series',    type: 'series', icon: '📺' },
    { id: 6, name: 'Deportes',  type: 'sports', icon: '⚽' }
]
```

## Notas

- La cuenta cuya sesión uses debe ser **miembro** del grupo para poder leer su contenido.
- La sesión puede caducar o invalidarse si cierras esa sesión desde Telegram; en ese caso
  vuelve a ejecutar `npm run login` y actualiza `TG_SESSION`.
- El streaming usa `Range` HTTP nativo, así que el `<video>` del navegador puede adelantar/retroceder.
