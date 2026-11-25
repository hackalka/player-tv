import { adminReady, json, readSession, sameOrigin } from "./_lib.js";

const PUBLIC_PATHS = new Set([
  "/api/admin/status",
  "/api/admin/login",
  "/api/admin/logout"
]);

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (PUBLIC_PATHS.has(url.pathname)) {
    if (request.method !== "GET" && !sameOrigin(request)) {
      return json({ error: "Origen no autorizado." }, 403);
    }
    return next();
  }

  if (!adminReady(env)) {
    return json({ error: "Administración no configurada. Revisa los secretos y el binding D1 en Cloudflare." }, 503);
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && !sameOrigin(request)) {
    return json({ error: "Origen no autorizado." }, 403);
  }

  const session = await readSession(request, env.ADMIN_SESSION_SECRET);
  if (!session) return json({ authenticated: false, error: "Se requiere iniciar sesión como administrador." }, 401);

  return next();
}
