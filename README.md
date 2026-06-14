# Tv Player

Catálogo estilo **Netflix** sobre un **grupo de Telegram**, **100% en el navegador**:
cada usuario entra con **su propia cuenta** (teléfono + 2FA) y el vídeo va **directo de
Telegram a su dispositivo**, usando **su** ancho de banda y **su** caché. El servidor solo
sirve archivos estáticos (unos KB), así que aguanta de sobra en un plan **gratuito**.

## ⚠️ Paso obligatorio la primera vez: generar el bundle

GramJS no funciona en el navegador desde un CDN; hay que empaquetarlo. Eso lo hace
**GitHub Actions** por ti (no necesitas instalar nada en tu PC):

1. En GitHub, ve a la pestaña **Actions**.
2. Abre el workflow **"Build Telegram bundle"** y pulsa **Run workflow** (elige la rama).
3. La Action genera y **sube** `public/vendor/telegram.bundle.js` al repo.
4. Railway redespliega y la web ya carga (sin CDN, sin errores de navegador).

> Mientras no exista ese archivo, la web mostrará un aviso pidiendo ejecutar la Action.
> El workflow también se ejecuta solo cuando cambian el script de build o el propio workflow.

## Configuración

Todo en **`public/config.js`** (se ejecuta en el navegador):

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

El servidor solo usa `PORT`.

## Desplegar (Railway u hosting estático)

```bash
npm install
npm start            # sirve public/ en el PORT (Railway o local)
```

Debe servirse por **HTTPS o localhost** (lo exige el Service Worker del streaming).

## Estructura

```
server/index.js                       Servidor estático (solo sirve public/)
webpack.config.js + build/entry.js    Genera el bundle de navegador (lo usa la Action)
.github/workflows/build-telegram-bundle.yml   CI que construye y sube el bundle
public/
  index.html         UI (carga vendor/telegram.bundle.js)
  config.js          Configuración de cliente
  tg-engine.js       Motor de Telegram en el navegador (login, catálogo, streaming)
  sw.js              Service Worker de streaming por rangos
  script.js          Interfaz
  vendor/telegram.bundle.js   (lo genera la GitHub Action)
```

## Cómo funciona

- El navegador carga el **bundle local** de GramJS y se conecta directo a Telegram (WSS).
- La sesión de cada usuario se guarda en su navegador (`localStorage`).
- El **Service Worker** sirve el vídeo por rangos pidiéndolo a Telegram con la cuenta del usuario.
- "Admin" = quien sea **administrador/creador** del grupo (automático): chat editar/borrar.

## Funciones

- Login por usuario (teléfono → código → 2FA), sesión en el navegador.
- Detalle Netflix (póster, sinopsis, metadatos), series por capítulos.
- Multi-enlace (DAZN 1/2/3), AceStream, `.mp4` directo, enlaces `t.me`.
- **Continuar viendo** (con ✕), **Mi lista**, **Novedades**, **buscador con filtros**.
- Chat admin (editar/borrar) solo para administradores del grupo.
- Navegación con **mando de TV Box**.

## Notas / límites

- **TV Box:** el navegador hace el trabajo (MTProto + streaming); en cajas muy básicas puede ir más justo.
- **mkv/avi:** no se reproducen en navegador; se ofrece **descargar**.
- `apiId/apiHash` quedan visibles en el navegador (es un cliente; usa unas dedicadas).
- Cada usuario debe poder **acceder al grupo** (y a los canales de los enlaces `t.me`).
