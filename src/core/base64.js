// @ts-check

/** Encode bytes as URL-safe base64 without padding. */
export function bytesToBase64Url(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** Decode URL-safe base64 without accepting malformed input. */
export function base64UrlToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new Error("Invalid base64url data.");
  }
  const remainder = value.length % 4;
  if (remainder === 1) throw new Error("Invalid base64url length.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - remainder) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

/** Render bytes as lowercase hexadecimal. */
export function bytesToHex(bytes) {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
