import { json } from "./_lib.js";

export async function onRequestGet({ env, request }) {
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 50));
  const result = await env.ADMIN_DB.prepare(
    "SELECT id, event, details_json, created_at FROM admin_audit_log ORDER BY id DESC LIMIT ?"
  ).bind(limit).all();
  return json({ entries: result.results || [] });
}
