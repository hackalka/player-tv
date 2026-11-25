import { adminReady, json, readSession } from "./_lib.js";

export async function onRequestGet({ request, env }) {
  const configured = adminReady(env);
  const session = configured ? await readSession(request, env.ADMIN_SESSION_SECRET) : null;
  return json({
    configured,
    authenticated: !!session,
    expiresAt: session ? session.expiresAt : null
  });
}
