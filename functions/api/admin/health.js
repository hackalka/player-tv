import { json } from "./_lib.js";

export async function onRequestGet({ env }) {
  let database = false;
  let databaseError = "";
  if (env.ADMIN_DB) {
    try {
      await env.ADMIN_DB.prepare("SELECT 1 AS ok").first();
      database = true;
    } catch (error) {
      databaseError = error?.message || "Error de conexión D1";
    }
  }

  return json({
    ok: database,
    platform: "Cloudflare Pages Functions",
    database,
    githubIntegration: false,
    repositoryConfigured: false,
    githubNote: "La integración GitHub para explorar y modificar archivos todavía no está implementada.",
    adminSecretsConfigured: !!(env.ADMIN_PASSWORD && env.ADMIN_SESSION_SECRET),
    databaseError
  });
}
