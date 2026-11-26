import { audit, json, sameOrigin } from "./_lib.js";

const MAX_TEXT = 4000;
function textValue(value, max = MAX_TEXT) {
  if (value == null) return "";
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}
function itemKey(groupId, topicId, messageId) {
  return [groupId, topicId, messageId].join(":");
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const group = url.searchParams.get("group");
  const topic = url.searchParams.get("topic");
  let query = "SELECT item_key, group_id, topic_id, message_id, title, description, poster_url, genres_json, updated_at FROM admin_catalog_overrides";
  const clauses = [], values = [];
  if (group) { clauses.push("group_id = ?"); values.push(group.slice(0, 100)); }
  if (topic) { clauses.push("topic_id = ?"); values.push(topic.slice(0, 100)); }
  if (clauses.length) query += " WHERE " + clauses.join(" AND ");
  query += " ORDER BY updated_at DESC LIMIT 500";
  const result = await env.ADMIN_DB.prepare(query).bind(...values).all();
  const items = (result.results || []).map(row => {
    let genres = [];
    try { genres = JSON.parse(row.genres_json || "[]"); } catch {}
    return { ...row, genres };
  });
  return json({ items, note: "Son metadatos administrativos vinculados a IDs de Telegram; no modifican mensajes originales." });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Origen no autorizado." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "JSON no válido." }, 400); }
  const groupId = textValue(body.groupId, 100);
  const topicId = textValue(body.topicId, 100);
  const messageId = textValue(body.messageId, 100);
  if (!groupId || !topicId || !messageId || [groupId, topicId, messageId].some(v => v === null)) {
    return json({ error: "Se requieren groupId, topicId y messageId." }, 400);
  }
  const title = textValue(body.title, 300);
  const description = textValue(body.description, 4000);
  const posterUrl = textValue(body.posterUrl, 1000);
  if ([title, description, posterUrl].some(v => v === null)) return json({ error: "Metadatos no válidos." }, 400);
  if (posterUrl && !/^https:\/\//i.test(posterUrl)) return json({ error: "La carátula debe usar una URL HTTPS." }, 400);
  const genres = Array.isArray(body.genres) ? body.genres.slice(0, 30).map(v => String(v).trim().slice(0, 60)).filter(Boolean) : [];
  const now = Date.now();
  const key = itemKey(groupId, topicId, messageId);
  await env.ADMIN_DB.prepare(
    "INSERT INTO admin_catalog_overrides (item_key, group_id, topic_id, message_id, title, description, poster_url, genres_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(item_key) DO UPDATE SET title = excluded.title, description = excluded.description, poster_url = excluded.poster_url, genres_json = excluded.genres_json, updated_at = excluded.updated_at"
  ).bind(key, groupId, topicId, messageId, title, description, posterUrl, JSON.stringify(genres), now).run();
  await audit(env, request, "admin.catalog_override.saved", { itemKey: key });
  return json({ saved: true, itemKey: key, updatedAt: now });
}

export async function onRequestDelete({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Origen no autorizado." }, 403);
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!/^.{1,302}$/s.test(key) || key.split(":").length !== 3) return json({ error: "Clave no válida." }, 400);
  await env.ADMIN_DB.prepare("DELETE FROM admin_catalog_overrides WHERE item_key = ?").bind(key).run();
  await audit(env, request, "admin.catalog_override.deleted", { itemKey: key });
  return json({ deleted: true, itemKey: key });
}
