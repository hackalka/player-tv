import { audit, json, sameOrigin } from "./_lib.js";

const KEY = /^(ui|player|catalog|system)\.[a-z0-9._-]{1,80}$/i;
const MAX_VALUE = 20000;

export async function onRequestGet({ env }) {
  const result = await env.ADMIN_DB.prepare(
    "SELECT setting_key, value_json, updated_at FROM admin_settings ORDER BY setting_key"
  ).all();
  const settings = (result.results || []).map(row => {
    let value = null;
    try { value = JSON.parse(row.value_json); } catch {}
    return { key: row.setting_key, value, updatedAt: row.updated_at };
  });
  return json({ settings });
}

export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Origen no autorizado." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "JSON no válido." }, 400); }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!KEY.test(key)) return json({ error: "Clave de configuración no permitida." }, 400);
  const valueJson = JSON.stringify(body.value);
  if (valueJson === undefined || valueJson.length > MAX_VALUE) {
    return json({ error: "El valor debe ser JSON válido y no superar 20 KB." }, 413);
  }
  const now = Date.now();
  await env.ADMIN_DB.prepare(
    "INSERT INTO admin_settings (setting_key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"
  ).bind(key, valueJson, now).run();
  await audit(env, request, "admin.settings.updated", { key });
  return json({ saved: true, key, updatedAt: now });
}

export async function onRequestDelete({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Origen no autorizado." }, 403);
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!KEY.test(key)) return json({ error: "Clave de configuración no permitida." }, 400);
  await env.ADMIN_DB.prepare("DELETE FROM admin_settings WHERE setting_key = ?").bind(key).run();
  await audit(env, request, "admin.settings.deleted", { key });
  return json({ deleted: true, key });
}
