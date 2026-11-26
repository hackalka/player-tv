import { json } from "./admin/_lib.js";

const PUBLIC_KEYS = new Set([
  "player.theme", "player.volume", "player.autoplay", "player.aspectRatio",
  "player.pip", "player.screenshot", "player.playbackRate",
  "ui.accentColor", "ui.backgroundColor", "ui.cardRadius", "ui.fontFamily"
]);

export async function onRequestGet({ env }) {
  const result = await env.ADMIN_DB.prepare(
    "SELECT setting_key, value_json FROM admin_settings WHERE setting_key LIKE 'player.%' OR setting_key LIKE 'ui.%'"
  ).all();
  const settings = {};
  for (const row of result.results || []) {
    if (!PUBLIC_KEYS.has(row.setting_key)) continue;
    try { settings[row.setting_key] = JSON.parse(row.value_json); } catch {}
  }
  return json({ settings });
}
