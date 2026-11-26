import { json } from "./_lib.js";

const REPOSITORY = "hackalka/player-tv";
const REF = "feature/cloudflare-admin";
const MAX_FILE_BYTES = 150 * 1024;
const ALLOWED_ROOTS = new Set(["docs", "functions", "migrations"]);

function validPath(value) {
  if (typeof value !== "string" || value.length > 300 || value.includes("\\") || value.startsWith("/")) return false;
  const parts = value.split("/").filter(Boolean);
  if (parts.some(part => part === "." || part === ".." || part.startsWith("."))) return false;
  return parts.length === 0 || ALLOWED_ROOTS.has(parts[0]);
}

async function github(path, env) {
  const suffix = path ? "/" + path.split("/").map(encodeURIComponent).join("/") : "";
  const url = "https://api.github.com/repos/" + REPOSITORY + "/contents" + suffix + "?ref=" + encodeURIComponent(REF);
  const response = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "TV-Player-Admin-ReadOnly",
      ...(typeof env.GITHUB_TOKEN === "string" && env.GITHUB_TOKEN
        ? { "Authorization": "Bearer " + env.GITHUB_TOKEN }
        : {})
    }
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Ruta no encontrada en la rama de administración.");
    if (response.status === 401) throw new Error("GitHub no aceptó GITHUB_TOKEN. Comprueba el secreto y sus permisos en Preview.");
    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get("X-RateLimit-Remaining");
      const reset = response.headers.get("X-RateLimit-Reset");
      if (remaining === "0" && reset) {
        const resetAt = new Date(Number(reset) * 1000).toLocaleTimeString("es-ES");
        throw new Error("GitHub ha agotado temporalmente el límite de consultas. Se restablecerá aproximadamente a las " + resetAt + ".");
      }
      throw new Error("GitHub ha rechazado la consulta. Comprueba que GITHUB_TOKEN tenga permiso de lectura del repositorio.");
    }
    throw new Error("GitHub no pudo responder (HTTP " + response.status + ").");
  }
  return response.json();
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") || "";
  const file = url.searchParams.get("file") === "1";
  if (!validPath(path)) return json({ error: "Ruta no permitida." }, 400);

  try {
    const data = await github(path, env);
    if (Array.isArray(data)) {
      const entries = data
        .filter(item => item.type === "dir" || item.type === "file")
        .map(item => ({
          name: item.name,
          path: item.path,
          type: item.type,
          size: item.size || 0,
          sha: item.sha
        }))
        .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1);
      return json({ path, entries, ref: REF, readOnly: true });
    }

    if (!file || data.type !== "file") return json({ error: "Solicita un archivo concreto." }, 400);
    if ((data.size || 0) > MAX_FILE_BYTES) {
      return json({ error: "Archivo demasiado grande para mostrarlo aquí (" + data.size + " bytes). El límite de vista es " + MAX_FILE_BYTES + " bytes.", path, size: data.size }, 413);
    }
    if (!data.content || data.encoding !== "base64") return json({ error: "GitHub no ha proporcionado el contenido de texto." }, 415);
    const binary = atob(data.content.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return json({ path, name: data.name, size: data.size || bytes.length, content, sha: data.sha, ref: REF, readOnly: true });
  } catch (error) {
    return json({ error: error.message || "No se pudo consultar el repositorio." }, 502);
  }
}
