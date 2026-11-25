import { audit, expiredCookie, json, sameOrigin } from "./_lib.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Origen no autorizado." }, 403);
  await audit(env, request, "admin.logout");
  return json({ authenticated: false }, 200, { "Set-Cookie": expiredCookie() });
}
