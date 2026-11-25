import { json, readSession } from "./_lib.js";

export async function onRequestGet({ request, env }) {
  const session = await readSession(request, env.ADMIN_SESSION_SECRET);
  if (!session) return json({ authenticated: false }, 401);
  return json({ authenticated: true, expiresAt: session.expiresAt, role: "owner" });
}
