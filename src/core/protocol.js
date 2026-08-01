// @ts-check

export const FRAME_PREFIX = "DOT2:";
export const FRAME_HEADER_LENGTH = 40;
export const PROTOCOL_VERSION = 2;
export const MAX_TRANSFER_BYTES = 128 * 1024 * 1024;
export const MAX_BLOCK_LENGTH = 2176;
export const MIN_BLOCK_LENGTH = 128;
export const MAX_BLOCK_COUNT = 160_000;

const MAGIC_0 = 0x44; // D
const MAGIC_1 = 0x4f; // O

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  crcTable = table;
  return table;
}

/** CRC-32 (IEEE), optionally continued from a previous finalized CRC. */
export function crc32(bytes, previous = 0) {
  const table = getCrcTable();
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (const byte of bytes) crc = (table[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

/** splitmix32 — deterministic across JavaScript engines. */
export function splitmix32(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let value = state ^ (state >>> 16);
    value = Math.imul(value, 0x21f0aaad);
    value ^= value >>> 15;
    value = Math.imul(value, 0x735a2d97);
    value ^= value >>> 15;
    return value >>> 0;
  };
}

/** Generate a cryptographically random 128-bit session identifier. */
export function createSessionId() {
  const sessionId = new Uint8Array(16);
  crypto.getRandomValues(sessionId);
  return sessionId;
}

export function sessionIdToHex(sessionId) {
  if (!(sessionId instanceof Uint8Array) || sessionId.length !== 16) throw new Error("Session ID must be 16 bytes.");
  return [...sessionId].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sessionSeed(sessionId) {
  return crc32(sessionId);
}

/**
 * @typedef {object} FrameHeader
 * @property {Uint8Array} sessionId
 * @property {number} sequence
 * @property {number} blockCount
 * @property {number} blockLength
 * @property {number} totalLength
 */

/** Pack and protect one fountain frame. */
export function packFrame(header, block) {
  validateHeader(header);
  if (!(block instanceof Uint8Array) || block.length !== header.blockLength) {
    throw new Error("Frame block length does not match its header.");
  }
  const out = new Uint8Array(FRAME_HEADER_LENGTH + block.length);
  const view = new DataView(out.buffer);
  view.setUint8(0, MAGIC_0);
  view.setUint8(1, MAGIC_1);
  view.setUint8(2, PROTOCOL_VERSION);
  view.setUint8(3, 0);
  out.set(header.sessionId, 4);
  view.setUint32(20, header.sequence >>> 0, true);
  view.setUint32(24, header.blockCount >>> 0, true);
  view.setUint16(28, header.blockLength, true);
  view.setUint16(30, 0, true);
  view.setUint32(32, header.totalLength >>> 0, true);
  out.set(block, FRAME_HEADER_LENGTH);
  let checksum = crc32(out.subarray(0, 36));
  checksum = crc32(block, checksum);
  view.setUint32(36, checksum, true);
  return out;
}

/** Parse a frame with strict limits and CRC validation. */
export function parseFrame(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length <= FRAME_HEADER_LENGTH) return null;
  if (bytes[0] !== MAGIC_0 || bytes[1] !== MAGIC_1 || bytes[2] !== PROTOCOL_VERSION || bytes[3] !== 0) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = {
    sessionId: bytes.slice(4, 20),
    sequence: view.getUint32(20, true),
    blockCount: view.getUint32(24, true),
    blockLength: view.getUint16(28, true),
    totalLength: view.getUint32(32, true),
  };

  try {
    validateHeader(header);
  } catch {
    return null;
  }
  if (view.getUint16(30, true) !== 0) return null;
  if (bytes.length !== FRAME_HEADER_LENGTH + header.blockLength) return null;
  if (header.blockCount !== Math.ceil(header.totalLength / header.blockLength)) return null;

  const expected = view.getUint32(36, true);
  let actual = crc32(bytes.subarray(0, 36));
  actual = crc32(bytes.subarray(FRAME_HEADER_LENGTH), actual);
  if (expected !== actual) return null;

  return { header, block: bytes.subarray(FRAME_HEADER_LENGTH) };
}

export function descriptorKey(header) {
  return `${sessionIdToHex(header.sessionId)}:${header.blockCount}:${header.blockLength}:${header.totalLength}`;
}

function validateHeader(header) {
  if (!(header.sessionId instanceof Uint8Array) || header.sessionId.length !== 16) throw new Error("Invalid session ID.");
  if (!Number.isInteger(header.sequence) || header.sequence < 0 || header.sequence > 0xffffffff) throw new Error("Invalid sequence.");
  if (!Number.isInteger(header.totalLength) || header.totalLength < 1 || header.totalLength > MAX_TRANSFER_BYTES) throw new Error("Transfer is outside the supported size limit.");
  if (!Number.isInteger(header.blockLength) || header.blockLength < MIN_BLOCK_LENGTH || header.blockLength > MAX_BLOCK_LENGTH) throw new Error("Invalid block length.");
  if (!Number.isInteger(header.blockCount) || header.blockCount < 1 || header.blockCount > MAX_BLOCK_COUNT) throw new Error("Invalid block count.");
}
