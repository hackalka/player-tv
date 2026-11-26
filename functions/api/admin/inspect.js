import { audit, json } from "./_lib.js";

const REPOSITORY = "hackalka/player-tv";
const REF = "feature/cloudflare-admin";
const MAX_FILES = 55;
const MAX_FILE_BYTES = 120 * 1024;
const SOURCE_EXT = /\.(?:html?|js|mjs|css|json)$/i;

function safeText(value) {
  return String(value || "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

async function github(path, token) {
  const response = await fetch("https://api.github.com/repos/" + REPOSITORY + path, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "TV-Player-Admin"
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("GitHub respondió HTTP " + response.status + " al inspeccionar la rama Preview.");
  return data;
}

function analyzeFile(path, content) {
  const lines = content.split("\n");
  const findings = [];
  const add = (severity, code, line, message) => findings.push({ severity, code, path, line, message });
  lines.forEach((line, index) => {
    if (/\beval\s*\(|new\s+Function\s*\(/.test(line)) add("high", "DYNAMIC_CODE", index + 1, "Ejecución dinámica de código; revisar el origen del contenido.");
    if (/TODO|FIXME|XXX/.test(line)) add("info", "TODO_MARKER", index + 1, "Marcador de tarea pendiente en el código.");
    if (/console\.(?:error|warn)\s*\(/.test(line)) add("info", "CONSOLE_LOG", index + 1, "Salida de diagnóstico en consola; comprobar si debe mantenerse.");
    if (/\.innerHTML\s*=/.test(line) && /\$\{|\+\s*[a-zA-Z_$][\w$]*/.test(line)) add("medium", "DYNAMIC_INNERHTML", index + 1, "HTML construido dinámicamente; verificar escape de datos no confiables.");
    if (/fetch\s*\(/.test(line) && /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(lines.slice(index, index + 5).join(" "))) {
      add("info", "HTTP_MUTATION", index + 1, "Petición que modifica datos; verificar autenticación, autorización y validación del servidor.");
    }
  });
  if (/\.html?$/i.test(path) && !/Content-Security-Policy/i.test(content)) {
    add("info", "CSP_NOT_IN_FILE", 1, "No se encontró una política CSP en este archivo; puede estar definida en cabeceras de Cloudflare.");
  }
  return findings;
}

function inventory(path, content, out) {
  const add = (type, name, file) => {
    if (name && name.length < 100) out.push({ type, name, file });
  };
  if (/\.html?$/i.test(path)) {
    for (const m of content.matchAll(/\bid=["']([^"']+)["']/g)) add("ID HTML", m[1], path);
    for (const m of content.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)) add("Recurso", m[1], path);
    for (const m of content.matchAll(/<([a-z][a-z0-9-]*-[a-z0-9-]+)\b/gi)) add("Elemento personalizado", m[1], path);
  }
  if (/\.(?:js|mjs)$/i.test(path)) {
    for (const m of content.matchAll(/\bfunction\s+([\w$]+)\s*\(/g)) add("Función", m[1], path);
    for (const m of content.matchAll(/\bclass\s+([\w$]+)/g)) add("Clase", m[1], path);
    for (const m of content.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g)) add("Función flecha", m[1], path);
    for (const m of content.matchAll(/customElements\.define\s*\(\s*['"]([^'"]+)/g)) add("Componente web", m[1], path);
  }
}

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_TOKEN) return json({ error: "Falta GITHUB_TOKEN en Preview." }, 503);
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "components" ? "components" : "audit";
  try {
    const ref = await github("/git/ref/heads/" + REF, env.GITHUB_TOKEN);
    const tree = await github("/git/trees/" + ref.object.sha + "?recursive=1", env.GITHUB_TOKEN);
    if (tree.truncated) return json({ error: "El árbol del repositorio supera el límite de inspección; no se presenta un informe incompleto como completo." }, 413);
    const candidates = (tree.tree || []).filter(x => x.type === "blob" && SOURCE_EXT.test(x.path) && !x.path.split("/").some(p => p.startsWith(".")));
    const files = candidates.slice(0, MAX_FILES);
    const truncated = candidates.length > MAX_FILES;
    const inspected = [];
    const findings = [];
    const components = [];
    for (const item of files) {
      if (item.size > MAX_FILE_BYTES) continue;
      const encoded = item.path.split("/").map(encodeURIComponent).join("/");
      const file = await github("/contents/" + encoded + "?ref=" + encodeURIComponent(REF), env.GITHUB_TOKEN);
      if (file.type !== "file" || !file.content) continue;
      const content = atob(file.content.replace(/\s/g, ""));
      const bytes = Uint8Array.from(content, c => c.charCodeAt(0));
      const source = new TextDecoder().decode(bytes);
      inspected.push({ path: item.path, bytes: item.size });
      if (mode === "audit") findings.push(...analyzeFile(item.path, source));
      else inventory(item.path, source, components);
    }
    await audit(env, request, mode === "audit" ? "github.repository.audit" : "github.repository.inventory", { files: inspected.length, findings: findings.length });
    if (mode === "components") {
      const unique = [...new Map(components.map(x => [x.type + "|" + x.name + "|" + x.file, x])).values()];
      return json({ ok: true, ref: REF, files: inspected, candidates: candidates.length, truncated, total: unique.length, components: unique.slice(0, 800) });
    }
    const counts = { high: findings.filter(x => x.severity === "high").length, medium: findings.filter(x => x.severity === "medium").length, info: findings.filter(x => x.severity === "info").length };
    return json({ ok: true, ref: REF, files: inspected, candidates: candidates.length, truncated, counts, findings: findings.slice(0, 400), note: "Análisis estático heurístico; no sustituye pruebas, revisión manual ni análisis de dependencias." });
  } catch (error) {
    return json({ error: error.message || "No se pudo inspeccionar el repositorio." }, 502);
  }
}
