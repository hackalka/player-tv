import { audit, expiredCookie, json, readSession, sameOrigin } from "./_lib.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Origen no autorizado." }, 403);
  const session = await readSession(request, env.ADMIN_SESSION_SECRET, env);
  if (session?.nonce) await env.ADMIN_DB.prepare("DELETE FROM admin_sessions WHERE nonce = ?").bind(session.nonce).run();
  await audit(env, request, "admin.logout");
  return json({ authenticated: false }, 200, { "Set-Cookie": expiredCookie() });
}
