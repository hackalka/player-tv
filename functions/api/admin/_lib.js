const COOKIE = "tvp_admin";
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}

export function adminReady(env) {
  return !!(env.ADMIN_DB &&
    typeof env.ADMIN_PASSWORD === "string" && env.ADMIN_PASSWORD.length >= 16 &&
    typeof env.ADMIN_SESSION_SECRET === "string" && env.ADMIN_SESSION_SECRET.length >= 32);
}

export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !!origin && origin === new URL(request.url).origin;
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function signingKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSessionToken(secret) {
  const payload = toBase64Url(encoder.encode(JSON.stringify({
    iat: Date.now(),
    exp: Date.now() + SESSION_SECONDS * 1000,
    nonce: crypto.randomUUID()
  })));
  const key = await signingKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return { token: payload + "." + toBase64Url(new Uint8Array(signature)), nonce: JSON.parse(new TextDecoder().decode(encoder.encode(JSON.stringify({ nonce: "unused" })))) && JSON.parse(new TextDecoder().decode(fromBase64Url(payload))).nonce, expiresAt: Date.now() + SESSION_SECONDS * 1000 };
}

export async function readSession(request, secret, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!match) return null;
  const parts = decodeURIComponent(match[1]).split(".");
  if (parts.length !== 2) return null;
  try {
    const key = await signingKey(secret);
    const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now() || !payload.nonce) return null;
    if (env?.ADMIN_DB) {
      const active = await env.ADMIN_DB.prepare("SELECT nonce FROM admin_sessions WHERE nonce = ? AND expires_at > ?").bind(payload.nonce, Date.now()).first();
      if (!active) return null;
    }
    return { nonce: payload.nonce, issuedAt: payload.iat, expiresAt: payload.exp };
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  return COOKIE + "=" + encodeURIComponent(token) + "; Path=/api/admin; Max-Age=" + SESSION_SECONDS + "; HttpOnly; Secure; SameSite=Strict";
}

export function expiredCookie() {
  return COOKIE + "=; Path=/api/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict";
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function constantTimeEqual(a, b) {
  const left = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(a))));
  const right = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(b))));
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

export async function clientIpHash(request) {
  return sha256(request.headers.get("CF-Connecting-IP") || "unknown");
}

export async function audit(env, request, event, details = {}) {
  if (!env.ADMIN_DB) return;
  const ipHash = await clientIpHash(request);
  await env.ADMIN_DB.prepare(
    "INSERT INTO admin_audit_log (event, ip_hash, details_json, created_at) VALUES (?, ?, ?, ?)"
  ).bind(event, ipHash, JSON.stringify(details), Date.now()).run();
}
