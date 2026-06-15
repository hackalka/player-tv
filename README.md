# Player TV — Cliente Telegram con doble vista (Netflix + Chat)

Cliente web que se conecta a tu grupo de Telegram (foro con temas) y muestra el
contenido de dos formas:

- **Vista Cine (estilo Netflix):** los temas multimedia (Películas, Series, Deportes)
  se muestran como un catálogo: banner *hero*, filas deslizables, tarjetas con poster
  y reproductor integrado.
- **Vista Chat (estilo Telegram):** el resto de temas "off topic" se ven como un chat
  normal de Telegram (lista de temas + burbujas de mensajes).

Todo corre **en el navegador**; te autenticas con tu cuenta de Telegram mediante un
**código QR** (igual que vincular Telegram Web).

## Estructura

| Archivo        | Descripción |
|----------------|-------------|
| `index.html`   | Estructura: navbar con conmutador de vista, vista Netflix y vista Telegram. |
| `style.css`    | Estilos Netflix + estilos de la vista Telegram. |
| `script.js`    | Motor de Telegram (GramJS), vistas Netflix/Telegram, reproductor y búsqueda. |
| `config.js`    | Configuración: credenciales, grupo y mapeo de temas. |
| `sw.js`        | Service Worker para **streaming de video por rangos** desde Telegram. |

## Configuración (`config.js`)

```js
window.CONFIG = {
    apiId: 8952741,                 // tus credenciales de my.telegram.org
    apiHash: '....',
    groupId: -1003924237464,        // ID del supergrupo/foro
    netflixTopics: [                // temas que se ven estilo Netflix
        { id: 2, name: 'Películas', type: 'movie',  icon: '🎬' },
        { id: 4, name: 'Series',    type: 'series', icon: '📺' },
        { id: 6, name: 'Deportes',  type: 'sports', icon: '⚽' }
    ]
};
```

El `id` de cada tema es el número que aparece tras el `_` en la URL de Telegram Web,
por ejemplo `https://web.telegram.org/a/#-1003924237464_2` → tema **2** (Películas).

## Cómo funciona

1. Carga GramJS y se conecta a Telegram. Si no hay sesión, muestra un **QR** para vincular.
2. Resuelve el grupo y lista sus **temas del foro** (`channels.GetForumTopics`).
3. Por cada tema configurado en `netflixTopics`, trae los mensajes (`getMessages` con
   `replyTo = idTema`), los convierte en tarjetas y los muestra en la **vista Cine**.
4. Los demás temas se muestran en la **vista Chat** con apariencia de Telegram.
5. Al reproducir un video nativo de Telegram, se hace **streaming por rangos** a través del
   Service Worker; si falla, descarga el archivo completo. Los enlaces externos se abren en un `iframe`.

## Uso en local

Sírvelo con cualquier servidor estático **por HTTPS o localhost** (el Service Worker lo exige):

```bash
npx serve .
# o
python3 -m http.server 8080
```

Luego abre la URL y escanea el QR con tu Telegram (Ajustes → Dispositivos → Vincular dispositivo).

## Notas

- Las credenciales de `config.js` son de cliente y quedan expuestas en el navegador: usa
  unas dedicadas para esta app.
- Para streaming completo, la app debe servirse desde un dominio con HTTPS (GitHub Pages,
  Netlify, etc.) para que el Service Worker funcione.
