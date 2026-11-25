import { adminReady, audit, clientIpHash, constantTimeEqual, createSessionToken, json, sameOrigin, sessionCookie } from "./_lib.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Origen no autorizado." }, 403);
  if (!adminReady(env)) return json({ error: "Falta configurar ADMIN_PASSWORD, ADMIN_SESSION_SECRET y el binding ADMIN_DB en Cloudflare." }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Solicitud no válida." }, 400); }
  const supplied = typeof body.password === "string" ? body.password : "";
  if (!supplied || supplied.length > 512) return json({ error: "Introduce la contraseña de administrador." }, 400);

  const now = Date.now();
  const ipHash = await clientIpHash(request);
  const recent = await env.ADMIN_DB.prepare(
    "SELECT COUNT(*) AS total FROM admin_login_attempts WHERE ip_hash = ? AND attempted_at >= ? AND success = 0"
  ).bind(ipHash, now - 15 * 60 * 1000).first();

  if ((recent?.total || 0) >= 8) {
    return json({ error: "Demasiados intentos. Espera 15 minutos." }, 429);
  }

  const valid = await constantTimeEqual(supplied, env.ADMIN_PASSWORD);
  await env.ADMIN_DB.prepare(
    "INSERT INTO admin_login_attempts (ip_hash, attempted_at, success) VALUES (?, ?, ?)"
  ).bind(ipHash, now, valid ? 1 : 0).run();

  if (!valid) {
    await audit(env, request, "admin.login.failed");
    return json({ error: "Contraseña incorrecta." }, 401);
  }

  const token = await createSessionToken(env.ADMIN_SESSION_SECRET);
  await audit(env, request, "admin.login.success");
  return json({ authenticated: true }, 200, { "Set-Cookie": sessionCookie(token) });
}
