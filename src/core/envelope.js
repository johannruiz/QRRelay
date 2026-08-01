// @ts-check
import { bytesToHex } from "./base64.js";
import { MAX_TRANSFER_BYTES } from "./protocol.js";

const OUTER_MAGIC = [0x44, 0x4f, 0x54, 0x45]; // DOTE
const INNER_MAGIC = [0x44, 0x4f, 0x54, 0x46]; // DOTF
const VERSION = 1;
const OUTER_HEADER_LENGTH = 40;
const INNER_HEADER_LENGTH = 48;
const FLAG_ENCRYPTED = 1;
const MAX_METADATA_LENGTH = 16 * 1024;
const PBKDF2_ITERATIONS = 210_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function estimateEnvelopeSize(fileSize, encrypted, metadataBytes = 512) {
  return OUTER_HEADER_LENGTH + INNER_HEADER_LENGTH + metadataBytes + fileSize + (encrypted ? 16 : 0);
}

/** Build a self-describing, integrity-protected file envelope. */
export async function createFileEnvelope(file, passphrase = "") {
  if (!(file instanceof Blob)) throw new Error("No file was selected.");
  validatePassphrase(passphrase, true);
  if (file.size < 0 || file.size > MAX_TRANSFER_BYTES - 65_536) throw new Error("The selected file is larger than the 128 MiB safety limit.");

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes));
  const metadata = {
    name: sanitizeFilename(typeof file.name === "string" ? file.name : "received-file"),
    type: sanitizeMimeType(typeof file.type === "string" ? file.type : ""),
    lastModified: Number.isFinite(file.lastModified) ? Math.max(0, Math.floor(file.lastModified)) : 0,
  };
  const metadataBytes = encoder.encode(JSON.stringify(metadata));
  if (metadataBytes.length > MAX_METADATA_LENGTH) throw new Error("File metadata is too large.");

  const inner = new Uint8Array(INNER_HEADER_LENGTH + metadataBytes.length + fileBytes.length);
  const innerView = new DataView(inner.buffer);
  inner.set(INNER_MAGIC, 0);
  innerView.setUint8(4, VERSION);
  innerView.setUint8(5, 0);
  innerView.setUint16(6, 0, true);
  innerView.setUint32(8, metadataBytes.length, true);
  innerView.setUint32(12, fileBytes.length, true);
  inner.set(digest, 16);
  inner.set(metadataBytes, INNER_HEADER_LENGTH);
  inner.set(fileBytes, INNER_HEADER_LENGTH + metadataBytes.length);

  const encrypted = passphrase.length > 0;
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  if (encrypted) { crypto.getRandomValues(salt); crypto.getRandomValues(iv); }
  const bodyLength = inner.length + (encrypted ? 16 : 0);
  const outer = new Uint8Array(OUTER_HEADER_LENGTH);
  const outerView = new DataView(outer.buffer);
  outer.set(OUTER_MAGIC, 0);
  outerView.setUint8(4, VERSION);
  outerView.setUint8(5, encrypted ? FLAG_ENCRYPTED : 0);
  outerView.setUint16(6, 0, true);
  outerView.setUint32(8, bodyLength, true);
  outer.set(salt, 12);
  outer.set(iv, 28);

  let body = inner;
  if (encrypted) {
    const key = await deriveAesKey(passphrase, salt, ["encrypt"]);
    body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: outer }, key, inner));
  }
  const result = new Uint8Array(outer.length + body.length);
  result.set(outer, 0);
  result.set(body, outer.length);
  if (result.length > MAX_TRANSFER_BYTES) throw new Error("The protected file is larger than the 128 MiB safety limit.");
  return { bytes: result, metadata, digestHex: bytesToHex(digest), encrypted };
}

/** Read only the public envelope flags. */
export function inspectFileEnvelope(bytes) {
  const outer = parseOuter(bytes);
  return { encrypted: (outer.flags & FLAG_ENCRYPTED) !== 0, bodyLength: outer.bodyLength };
}

/** Decrypt (when needed), parse metadata, and verify SHA-256. */
export async function openFileEnvelope(bytes, passphrase = "") {
  validatePassphrase(passphrase, false);
  const outer = parseOuter(bytes);
  const encrypted = (outer.flags & FLAG_ENCRYPTED) !== 0;
  let inner = bytes.subarray(OUTER_HEADER_LENGTH);
  if (encrypted) {
    if (!passphrase) return { requiresPassphrase: true, encrypted: true };
    try {
      const key = await deriveAesKey(passphrase, outer.salt, ["decrypt"]);
      inner = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: outer.iv, additionalData: bytes.subarray(0, OUTER_HEADER_LENGTH) }, key, inner));
    } catch {
      throw new Error("The passphrase is incorrect, or the transfer was damaged.");
    }
  }

  if (inner.length < INNER_HEADER_LENGTH || !matchesMagic(inner, INNER_MAGIC)) throw new Error("The reconstructed file container is invalid.");
  const view = new DataView(inner.buffer, inner.byteOffset, inner.byteLength);
  if (view.getUint8(4) !== VERSION || view.getUint8(5) !== 0 || view.getUint16(6, true) !== 0) throw new Error("Unsupported file container version.");
  const metadataLength = view.getUint32(8, true);
  const fileLength = view.getUint32(12, true);
  if (metadataLength > MAX_METADATA_LENGTH || fileLength > MAX_TRANSFER_BYTES) throw new Error("Invalid file container limits.");
  if (INNER_HEADER_LENGTH + metadataLength + fileLength !== inner.length) throw new Error("The reconstructed file size is inconsistent.");

  let metadata;
  try {
    metadata = JSON.parse(decoder.decode(inner.subarray(INNER_HEADER_LENGTH, INNER_HEADER_LENGTH + metadataLength)));
  } catch {
    throw new Error("The file metadata is invalid.");
  }
  const normalized = validateMetadata(metadata);
  const fileBytes = inner.slice(INNER_HEADER_LENGTH + metadataLength);
  const expectedDigest = inner.subarray(16, 48);
  const actualDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes));
  if (!constantTimeEqual(expectedDigest, actualDigest)) throw new Error("SHA-256 verification failed. The file will not be opened.");

  return {
    requiresPassphrase: false,
    encrypted,
    metadata: normalized,
    fileBytes,
    digestHex: bytesToHex(actualDigest),
  };
}

function parseOuter(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < OUTER_HEADER_LENGTH || bytes.length > MAX_TRANSFER_BYTES) throw new Error("Invalid transfer envelope size.");
  if (!matchesMagic(bytes, OUTER_MAGIC)) throw new Error("This is not a QR Relay transfer envelope.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(4) !== VERSION || view.getUint16(6, true) !== 0) throw new Error("Unsupported transfer envelope version.");
  const flags = view.getUint8(5);
  if ((flags & ~FLAG_ENCRYPTED) !== 0) throw new Error("Unsupported transfer envelope flags.");
  const bodyLength = view.getUint32(8, true);
  if (bodyLength < INNER_HEADER_LENGTH || bodyLength > MAX_TRANSFER_BYTES || OUTER_HEADER_LENGTH + bodyLength !== bytes.length) throw new Error("Transfer envelope length is inconsistent.");
  return { flags, bodyLength, salt: bytes.slice(12, 28), iv: bytes.slice(28, 40) };
}

function validatePassphrase(passphrase, forCreation) {
  if (typeof passphrase !== "string") throw new Error("Passphrase must be text.");
  if (passphrase.length > 256 || encoder.encode(passphrase).length > 1024) throw new Error("Passphrase is too long.");
  if (forCreation && passphrase.length > 0 && passphrase.length < 10) throw new Error("Use a passphrase with at least 10 characters.");
}

async function deriveAesKey(passphrase, salt, usages) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

function matchesMagic(bytes, magic) {
  return magic.every((value, index) => bytes[index] === value);
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function validateMetadata(value) {
  if (!value || typeof value !== "object") throw new Error("Missing file metadata.");
  return {
    name: sanitizeFilename(typeof value.name === "string" ? value.name : "received-file"),
    type: sanitizeMimeType(typeof value.type === "string" ? value.type : ""),
    lastModified: Number.isFinite(value.lastModified) ? Math.max(0, Math.floor(value.lastModified)) : 0,
  };
}

export function sanitizeFilename(name) {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "_").trim().slice(0, 240);
  return cleaned || "received-file";
}

/** Keep MIME metadata inert and standards-shaped before using it in a Blob. */
export function sanitizeMimeType(type) {
  if (typeof type !== "string") return "application/octet-stream";
  const normalized = type.trim().toLowerCase();
  const token = "[a-z0-9!#$&^_.+-]";
  const pattern = new RegExp(`^${token}{1,127}/${token}{1,127}$`);
  return pattern.test(normalized) ? normalized : "application/octet-stream";
}
