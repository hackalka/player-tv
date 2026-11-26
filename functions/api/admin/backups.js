import { audit, json, sameOrigin } from "./_lib.js";

async function snapshot(env) {
  const [settings, overrides] = await Promise.all([
    env.ADMIN_DB.prepare("SELECT setting_key, value_json, updated_at FROM admin_settings ORDER BY setting_key").all(),
    env.ADMIN_DB.prepare("SELECT item_key, group_id, topic_id, message_id, title, description, poster_url, genres_json, updated_at FROM admin_catalog_overrides ORDER BY item_key").all()
  ]);
  return { version: 1, settings: settings.results || [], overrides: overrides.results || [] };
}

export async function onRequestGet({ env }) {
  const result = await env.ADMIN_DB.prepare(
    "SELECT id, backup_type, label, created_at, length(payload_json) AS bytes FROM admin_backups ORDER BY id DESC LIMIT 100"
  ).all();
  return json({ backups: result.results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Origen no autorizado." }, 403);
  let body = {};
  try { body = await request.json(); } catch {}
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "";
  const payload = await snapshot(env);
  const encoded = JSON.stringify(payload);
  if (encoded.length > 900000) return json({ error: "La copia supera el límite de almacenamiento." }, 413);
  const now = Date.now();
  const result = await env.ADMIN_DB.prepare(
    "INSERT INTO admin_backups (backup_type, label, payload_json, created_at) VALUES ('workspace', ?, ?, ?)"
  ).bind(label || "Copia manual", encoded, now).run();
  await audit(env, request, "admin.backup.created", { id: result.meta?.last_row_id || null });
  return json({ created: true, id: result.meta?.last_row_id || null, createdAt: now });
}

export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Origen no autorizado." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "JSON no válido." }, 400); }
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id < 1) return json({ error: "Identificador de copia no válido." }, 400);
  const backup = await env.ADMIN_DB.prepare("SELECT payload_json FROM admin_backups WHERE id = ?").bind(id).first();
  if (!backup) return json({ error: "No existe esa copia." }, 404);
  let payload;
  try { payload = JSON.parse(backup.payload_json); } catch { return json({ error: "La copia está dañada." }, 422); }
  if (payload.version !== 1 || !Array.isArray(payload.settings) || !Array.isArray(payload.overrides)) {
    return json({ error: "Formato de copia no compatible." }, 422);
  }

  const current = await snapshot(env);
  const now = Date.now();
  const statements = [
    env.ADMIN_DB.prepare("INSERT INTO admin_backups (backup_type, label, payload_json, created_at) VALUES ('workspace', ?, ?, ?)")
      .bind("Seguridad previa a restaurar #" + id, JSON.stringify(current), now),
    env.ADMIN_DB.prepare("DELETE FROM admin_settings"),
    env.ADMIN_DB.prepare("DELETE FROM admin_catalog_overrides")
  ];
  for (const row of payload.settings) {
    statements.push(env.ADMIN_DB.prepare(
      "INSERT INTO admin_settings (setting_key, value_json, updated_at) VALUES (?, ?, ?)"
    ).bind(row.setting_key, row.value_json, Number(row.updated_at) || now));
  }
  for (const row of payload.overrides) {
    statements.push(env.ADMIN_DB.prepare(
      "INSERT INTO admin_catalog_overrides (item_key, group_id, topic_id, message_id, title, description, poster_url, genres_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(row.item_key, row.group_id, row.topic_id, row.message_id, row.title, row.description, row.poster_url, row.genres_json || "[]", Number(row.updated_at) || now));
  }
  await env.ADMIN_DB.batch(statements);
  await audit(env, request, "admin.backup.restored", { id });
  return json({ restored: true, id, safetyBackupCreated: true });
}
