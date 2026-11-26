# Preparar el panel de administración en Cloudflare

Esta rama añade la primera capa de administración al proyecto Pages existente. No cambia el reproductor ni `docs/index.html`, no crea una base de datos en tu cuenta y no despliega producción.

## Lo que ya incluye esta rama

- Pantalla de acceso independiente de la sesión de Telegram.
- Cookie de administrador HttpOnly, Secure y SameSite=Strict.
- Sesiones firmadas, con caducidad de 8 horas y revocación en D1 al cerrar sesión.
- Límite de 8 intentos fallidos por IP anonimizada durante 15 minutos.
- Endpoints protegidos para estado, sesión, salud y registro de auditoría.
- Migración SQL para intentos, sesiones, auditoría y ajustes.
- El panel no habilita acciones de edición que todavía no estén implementadas.

## Configuración necesaria en Cloudflare

Hazlo primero en el entorno Preview, nunca en Production mientras se revisa esta rama.

1. Abre **Workers & Pages → player-tv → Settings → Bindings**.
2. Crea o selecciona una base D1 para el panel y añádela al proyecto con el nombre de variable **ADMIN_DB**.
3. En **Settings → Variables and Secrets**, crea estos secretos:
   - **ADMIN_PASSWORD**: contraseña administrativa aleatoria de al menos 16 caracteres.
   - **ADMIN_SESSION_SECRET**: valor aleatorio de al menos 32 caracteres.
4. Aplica la migración `migrations/0001_admin.sql` a la base D1 elegida. Con Wrangler:
   ```bash
   npx wrangler d1 execute NOMBRE_DE_TU_BASE --remote --file=migrations/0001_admin.sql
   ```
5. Comprueba que la salida de compilación de Pages siga siendo `docs` y que la carpeta `functions/` de la raíz del repositorio se detecte como Pages Functions. No cambies la configuración de producción para hacer esta comprobación.
6. Revisa la rama `feature/cloudflare-admin` en Preview. La dirección principal `player-tv.pages.dev` no debe cambiarse ni promoverse desde esta rama.

## Importante: alcance actual

Esta primera integración asegura el acceso al panel y proporciona persistencia D1 para sesiones y auditoría. **No equivale todavía a tener todos los permisos de administración de la aplicación.** La integración GitHub para explorar/editar archivos, auditoría real de código, catálogo Telegram, configuración del reproductor, backups y acciones de escritura todavía requieren sus APIs específicas, permisos mínimos, pruebas y confirmación.

No introduzcas tokens de GitHub, credenciales de Telegram ni secretos de producción en archivos del repositorio. Los secretos van en Cloudflare, cifrados. No reutilices contraseñas de Telegram.

## Rollback

Como los cambios están en `feature/cloudflare-admin`, basta con no fusionar ni promover esta rama. La rama `main` y el contenido publicado no se han editado desde esta rama.


## Segunda migración: espacio administrativo

La rama `feature/cloudflare-admin` añade `migrations/0002_admin_workspace.sql`. Aplícala también a la misma base D1 vinculada como `ADMIN_DB` en Preview antes de usar `admin-workspace.html`:

```bash
npx wrangler d1 execute NOMBRE_DE_TU_BASE --remote --file=migrations/0002_admin_workspace.sql
```

Esta migración crea las tablas de copias de seguridad del espacio administrativo y metadatos de catálogo separados de los mensajes originales de Telegram. Las copias actuales incluyen ajustes y metadatos de D1; no son copias de los archivos del repositorio ni de los datos alojados en Telegram.
prueba