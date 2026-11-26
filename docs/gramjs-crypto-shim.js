import { sha1 } from "https://esm.sh/@noble/hashes@1.4.0/sha1?bundle";
import { sha256 } from "https://esm.sh/@noble/hashes@1.4.0/sha256?bundle";

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value && value.buffer instanceof ArrayBuffer) {
    return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  throw new TypeError("Unsupported hash input");
}

function createHash(algorithm) {
  const name = String(algorithm).toLowerCase().replace("-", "");
  if (name !== "sha1" && name !== "sha256") {
    throw new Error("Unsupported browser hash algorithm: " + algorithm);
  }
  const chunks = [];
  return {
    update(data) {
      chunks.push(asBytes(data).slice());
      return this;
    },
    digest(encoding) {
      const length = chunks.reduce((n, part) => n + part.length, 0);
      const input = new Uint8Array(length);
      let offset = 0;
      for (const part of chunks) {
        input.set(part, offset);
        offset += part.length;
      }
      const result = (name === "sha1" ? sha1 : sha256)(input);
      if (encoding === "hex") {
        return Array.from(result, b => b.toString(16).padStart(2, "0")).join("");
      }
      if (encoding === "base64") {
        let binary = "";
        for (const b of result) binary += String.fromCharCode(b);
        return btoa(binary);
      }
      if (!globalThis.Buffer) throw new Error("Buffer polyfill not initialized");
      return globalThis.Buffer.from(result);
    }
  };
}

function randomBytes(size) {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  if (!globalThis.Buffer) throw new Error("Buffer polyfill not initialized");
  return globalThis.Buffer.from(bytes);
}

export { createHash, randomBytes };
export default { createHash, randomBytes };
