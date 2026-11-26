import { json } from "./admin/_lib.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const group = (url.searchParams.get("group") || "").trim().slice(0, 100);
  if (!group) return json({ items: [] });
  const result = await env.ADMIN_DB.prepare(
    "SELECT group_id, topic_id, message_id, title, description, poster_url, genres_json FROM admin_catalog_overrides WHERE group_id = ? ORDER BY updated_at DESC LIMIT 1000"
  ).bind(group).all();
  const items = (result.results || []).map(row => {
    let genres = [];
    try { genres = JSON.parse(row.genres_json || "[]"); } catch {}
    return { topicId: String(row.topic_id), messageId: String(row.message_id), title: row.title || "", description: row.description || "", posterUrl: row.poster_url || "", genres };
  });
  return json({ items });
}
