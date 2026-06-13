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

### 1) Generar la sesión (TG_SESSION)

Tienes **dos formas**. La A es la más fácil (sin instalar nada).

#### A) Asistente web (recomendado, sin PC ni terminal)

1. Despliega primero en Railway con `TG_API_ID`, `TG_API_HASH`, `TG_GROUP_ID`, etc.
   (puedes dejar `TG_SESSION` vacío de momento).
2. Abre la URL de tu app: al no haber sesión, aparece el **asistente de configuración**.
3. Escribe tu **teléfono** → el **código** que te llega por Telegram → tu **2FA** si tienes.
4. Te muestra una **clave**. Cópiala y pégala en Railway como variable **`TG_SESSION`**.
5. Railway se reinicia solo y la web ya muestra tu contenido. (El asistente se desactiva solo.)

#### B) Por terminal (en tu ordenador, una vez)

```bash
npm install
npm run login
```

Introduce tu teléfono, el código y tu 2FA. Copia la cadena larga que imprime y ponla
como `TG_SESSION` en Railway. **No la subas a GitHub.**

### 2) Desplegar en Railway

1. Sube este repo a GitHub y crea un proyecto en Railway desde el repo.
2. En **Variables**, añade:
   - `TG_API_ID` y `TG_API_HASH` (de https://my.telegram.org)
   - `TG_SESSION` = la cadena del paso 1
   - `TG_GROUP_ID` = `-1003749684388`
   - `APP_NAME` = `Tv Player`
   - `AUTO_TAG` = `playertv:auto` (o varias separadas por coma)
   - `ADMIN_PASSWORD` = una contraseña tuya (para el chat y editar/borrar). Si la dejas vacía, no hay panel admin.
3. Railway construye con Nixpacks y arranca con `npm start`. La web queda lista **sin login**.

### 3) Local (opcional)

```bash
cp .env.example .env   # rellena TG_SESSION
npm install
npm start              # http://localhost:3000
```

## Qué temas aparecen (auto-descubrimiento por etiqueta)

La web **descubre los temas sola** y **solo muestra** los que tengan una etiqueta en el título.
Por defecto acepta `playertv:auto` y `tvplayer:auto` (configurable con `AUTO_TAG`, separadas por coma).

- Un tema titulado **"Películas playertv:auto"** se muestra como **"Películas"**.
- Los temas **sin** la etiqueta **no aparecen** en ninguna parte de la web.

Así controlas desde Telegram qué temas se publican en la web: basta con añadir o quitar la
etiqueta en el título del tema.

## Notas

- La cuenta cuya sesión uses debe ser **miembro** del grupo para poder leer su contenido.
- La sesión puede caducar o invalidarse si cierras esa sesión desde Telegram; en ese caso
  vuelve a ejecutar `npm run login` y actualiza `TG_SESSION`.
- El streaming usa `Range` HTTP nativo, así que el `<video>` del navegador puede adelantar/retroceder.


## Funciones de la app

- **Continuar viendo:** recuerda por dónde ibas (guarda el minuto en tu navegador) y muestra una fila arriba. En series recuerda el último capítulo.
- **Mi lista (favoritos):** botón en el detalle para guardar títulos; aparecen en su propia fila.
- **Sin duplicados:** en películas/deportes, si hay dos con el mismo nombre o el mismo vídeo, solo se muestra uno. En series no se repiten capítulos.
- **Reproductores externos:** si el vídeo es `mkv`, `avi` u otro formato que el navegador no reproduce, el detalle ofrece abrirlo en **VLC** o **copiar el enlace**. Los enlaces **AceStream** muestran un botón directo (`acestream://`) y un acceso para Android.
- **Chat solo para administradores:** la pestaña *Chat* está oculta. Pulsa el **candado** (arriba a la derecha) e introduce `ADMIN_PASSWORD` para verla. Desde ahí, un admin puede **editar** o **borrar** mensajes del grupo.
- **TV Box y mando:** navegación con flechas (↑↓←→), **OK** para abrir/reproducir y **Atrás** para cerrar. Los elementos enfocados se resaltan.


## Posts con varios enlaces (deportes en directo, multi-canal)

Puedes poner **título, sinopsis y varios enlaces en un mismo mensaje**. La sinopsis se lee
en la ficha y los enlaces salen como botones (Enlace 1, 2, 3…). Cada línea de texto que va
justo **encima** de un enlace se usa como su nombre. Ejemplo:

```
🇪🇸 Mundial Fútbol 🇪🇸
Resumen o sinopsis del evento (opcional)

Enlace DAZN 1
acestream://dda5d2cace9bc4cb0918e62bc50d657d4a10496a
Enlace DAZN 2
acestream://3c4185422b04ef24c80e015210339f805d80f9f0
Enlace TVE La 1
acestream://9c079e1bbd01814c107e89187b8c24ba0ac306dd
```

En la ficha aparecerán los botones **Enlace DAZN 1 / DAZN 2 / TVE La 1**, cada uno abre su
enlace AceStream (o se copia). Sirve igual con enlaces `https://` (se abren / van a VLC).
