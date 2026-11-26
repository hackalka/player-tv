import { audit, json } from "./_lib.js";

const REPOSITORY = "hackalka/player-tv";
const REF = "feature/cloudflare-admin";
const MAX_FILE_BYTES = 150 * 1024;

function validEditablePath(value) {
  if (typeof value !== "string" || value.length > 300 || value.includes("\\") || value.startsWith("/")) return false;
  const parts = value.split("/");
  if (parts.length < 2 || parts[0] !== "docs") return false;
  if (parts.some(part => !part || part === "." || part === ".." || part.startsWith("."))) return false;
  if (["index.html", "admin.html", "admin-workspace.html"].includes(parts.at(-1))) return false;
  return /\.(html|css|js|json|md|txt|svg|webmanifest)$/i.test(parts.at(-1));
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function githubRequest(path, token, options = {}) {
  const url = "https://api.github.com/repos/" + REPOSITORY + path;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "TV-Player-Admin",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 409 || response.status === 422
      ? "El archivo cambió o GitHub rechazó el commit. Actualiza el archivo y vuelve a intentarlo."
      : response.status === 401 || response.status === 403
        ? "GitHub rechazó el token o sus permisos. Comprueba GITHUB_TOKEN en Preview."
        : "GitHub respondió con HTTP " + response.status + ".";
    throw new Error(message);
  }
  return data;
}

export async function onRequestPost({ request, env }) {
  if (typeof env.GITHUB_TOKEN !== "string" || !env.GITHUB_TOKEN) {
    return json({ error: "Falta el secreto GITHUB_TOKEN en el entorno Preview." }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "JSON no válido." }, 400); }
  const { path, content, expectedSha, message } = body || {};
  if (!validEditablePath(path)) return json({ error: "Ruta no permitida. Solo se pueden editar archivos de docs/; index.html y los archivos del panel están protegidos." }, 400);
  if (typeof content !== "string") return json({ error: "El contenido debe ser texto." }, 400);
  if (new TextEncoder().encode(content).length > MAX_FILE_BYTES) return json({ error: "El archivo supera el límite de 150 KB." }, 413);
  if (typeof expectedSha !== "string" || !/^[a-f0-9]{40}$/i.test(expectedSha)) return json({ error: "Falta la versión actual del archivo. Vuelve a cargarlo antes de guardar." }, 400);
  const commitMessage = typeof message === "string" && message.trim() ? message.trim().slice(0, 120) : "Update " + path + " from TV Player admin";

  try {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const current = await githubRequest("/contents/" + encodedPath + "?ref=" + encodeURIComponent(REF), env.GITHUB_TOKEN);
    if (current.type !== "file" || current.sha !== expectedSha) {
      return json({ error: "Este archivo cambió en GitHub desde que lo abriste. Recárgalo para evitar sobrescribir cambios recientes.", conflict: true }, 409);
    }

    const updated = await githubRequest("/contents/" + encodedPath, env.GITHUB_TOKEN, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage,
        content: encodeBase64(content),
        sha: current.sha,
        branch: REF
      })
    });

    await audit(env, request, "github.file.updated", { path, branch: REF, commit: updated.commit?.sha || null });
    return json({ ok: true, path, branch: REF, commit: updated.commit?.sha || null, url: updated.content?.html_url || null });
  } catch (error) {
    return json({ error: error.message || "No se pudo guardar el archivo." }, 502);
  }
}
