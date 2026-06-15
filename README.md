# Tv Player

Catálogo estilo **Netflix** sobre un **grupo de Telegram**, con **una sesión por usuario**:
cada persona entra con **su propia cuenta** (teléfono + 2FA) y el contenido se sirve a través
de **su** sesión. Pensado para desplegar en **Railway** (o cualquier host de Node).

- **Vista Cine (Netflix):** temas con la etiqueta configurada (películas, series, deportes…).
- **Vista Chat (Telegram):** solo para **administradores del grupo** (editar / borrar contenido).
- **Login por usuario** dentro de la web (sin terminal, sin bots).
- **Admin automático:** quien sea administrador/creador del grupo en Telegram ve el panel de chat.

## Arranque rápido (Railway)

1. Sube el repo a GitHub y crea el servicio en Railway desde el repo.
2. En **Variables** pon:
   - `TG_API_ID`, `TG_API_HASH` (de https://my.telegram.org)
   - `TG_GROUP_ID` = `-1003749684388`
   - `APP_NAME` = `Tv Player`
   - `AUTO_TAG` = `playertv:auto`
   - *(opcional)* `DATA_DIR` = una ruta persistente para guardar las sesiones de usuario.
3. Railway construye con Nixpacks y arranca con `npm start`.
4. **Settings → Networking → Generate Domain** para tener la URL pública.
5. Abre la web: cada usuario inicia sesión con **su teléfono + código + 2FA**.

> Sin `TG_SESSION` ni `ADMIN_PASSWORD`: el acceso es por usuario y el rol de admin se detecta
> automáticamente según los permisos de esa cuenta en el grupo.

## Local

```bash
cp .env.example .env
npm install
npm start            # http://localhost:3000
```

## Arquitectura

```
server/
  index.js      API + streaming por rangos + auth por cookie + sirve el frontend
  sessions.js   Una sesión/cliente de Telegram POR usuario (login + persistencia)
  telegram.js   Motor ligado al cliente de cada usuario (catálogo, temas, streaming)
  config.js     Configuración por variables de entorno
public/         Frontend (login, catálogo Netflix, chat admin, navegación TV)
```

Cada usuario tiene su propio cliente de Telegram en el servidor (relé), así que **el streaming
y las descargas usan la cuenta de cada usuario** y su propio acceso al grupo.

## Temas que se muestran

Solo se muestran los temas del foro cuyo **título** contenga la etiqueta (por defecto
`playertv:auto` o `tvplayer:auto`, configurable con `AUTO_TAG`). El nombre se muestra **sin** la
etiqueta: un tema "Películas playertv:auto" se ve como "Películas".

## Formatos de publicación admitidos

- **Vídeo subido a Telegram** (mp4/mkv/avi…): se reproduce dentro (mkv/avi → reproductor externo).
- **Varios enlaces en un post** (deportes/multicanal): "Enlace DAZN 1/2/3", AceStream, `.mp4`, etc.
- **Serie en un solo post**: título + metadatos + sinopsis + episodios como enlaces `t.me`
  (se reproducen aunque estén en otro canal público al que el usuario tenga acceso).

## Funciones

- Vista de detalle estilo Netflix (póster, sinopsis, metadatos, botón Ver).
- Series agrupadas por capítulos.
- **Continuar viendo** (con botón ✕ para quitar) y **Mi lista** (favoritos).
- **Novedades** y **buscador con filtros** por género/año.
- Reproductores externos (VLC / AceStream) y copiar enlace.
- **Chat admin** (editar/borrar) solo para administradores del grupo.
- Navegación con **mando de TV Box** (flechas / OK / atrás).
- Caché de miniaturas, streaming con reintentos y cabeceras de seguridad básicas.

## Notas

- La cuenta de cada usuario debe poder **acceder al grupo** (y a los canales de los enlaces `t.me`).
- Las sesiones se guardan en `DATA_DIR`; si usas el directorio temporal, un redeploy puede
  cerrar sesiones (los usuarios vuelven a entrar).
- El servidor actúa de relé: el ancho de banda de streaming pasa por el servidor (Railway).
