import test from "node:test";
import assert from "node:assert/strict";
import { File } from "node:buffer";
import { bytesToBase64Url, base64UrlToBytes } from "../src/core/base64.js";
import { createFileEnvelope, inspectFileEnvelope, openFileEnvelope, sanitizeFilename, sanitizeMimeType } from "../src/core/envelope.js";
import { LTDecoder, LTEncoder } from "../src/core/fountain.js";
import { createSessionId, FRAME_HEADER_LENGTH, FRAME_PREFIX, packFrame, parseFrame, sessionSeed } from "../src/core/protocol.js";
import { createQrMatrix } from "../vendor/qrcode.js";

if (!globalThis.crypto) {
  const { webcrypto } = await import("node:crypto");
  globalThis.crypto = webcrypto;
}

if (!globalThis.File) globalThis.File = File;

test("base64url round-trips arbitrary bytes", () => {
  const input = Uint8Array.from({ length: 1025 }, (_, index) => (index * 73 + 19) & 0xff);
  assert.deepEqual(base64UrlToBytes(bytesToBase64Url(input)), input);
  assert.throws(() => base64UrlToBytes("broken*value"));
});

test("frame protocol rejects damage and inconsistent metadata", () => {
  const sessionId = createSessionId();
  const block = Uint8Array.from({ length: 512 }, (_, index) => index & 0xff);
  const frame = packFrame({ sessionId, sequence: 42, blockCount: 4, blockLength: 512, totalLength: 2048 }, block);
  const parsed = parseFrame(frame);
  assert.ok(parsed);
  assert.equal(parsed.header.sequence, 42);
  assert.deepEqual(parsed.block, block);

  const damaged = frame.slice();
  damaged[damaged.length - 3] ^= 0x40;
  assert.equal(parseFrame(damaged), null);

  const inconsistent = frame.slice();
  new DataView(inconsistent.buffer).setUint32(24, 5, true);
  assert.equal(parseFrame(inconsistent), null);
});

test("fountain decoder reconstructs data after loss and reordering", () => {
  const payload = Uint8Array.from({ length: 78_321 }, (_, index) => (index * 31 + (index >>> 3)) & 0xff);
  const blockLength = 768;
  const seed = 0x7a21f09d;
  const encoder = new LTEncoder(payload, blockLength, seed);
  const candidates = [];
  for (let sequence = 0; sequence < Math.ceil(encoder.blockCount * 2.4); sequence += 1) {
    if (sequence % 7 !== 0) candidates.push(sequence);
  }
  // Deterministic reorder: odds first, then evens in reverse.
  candidates.sort((left, right) => ((left & 1) - (right & 1)) || (right - left));
  const decoder = new LTDecoder(encoder.blockCount, blockLength, seed, payload.length);
  for (const sequence of candidates) {
    decoder.addFrame(sequence, encoder.encode(sequence));
    if (decoder.isComplete) break;
  }
  assert.equal(decoder.isComplete, true);
  assert.deepEqual(decoder.assemble(), payload);
});

test("plain and encrypted file envelopes preserve any binary file", async () => {
  const data = Uint8Array.from({ length: 24_000 }, (_, index) => (index * 17) & 0xff);
  const file = new File([data], "sample.data.bin", { type: "application/octet-stream", lastModified: 1_700_000_000_000 });

  await assert.rejects(() => createFileEnvelope(file, "short"));
  const plain = await createFileEnvelope(file, "");
  assert.equal(inspectFileEnvelope(plain.bytes).encrypted, false);
  const plainOpened = await openFileEnvelope(plain.bytes, "");
  assert.equal(plainOpened.requiresPassphrase, false);
  assert.equal(plainOpened.metadata.name, "sample.data.bin");
  assert.deepEqual(plainOpened.fileBytes, data);

  const encrypted = await createFileEnvelope(file, "correct horse battery staple");
  assert.equal(inspectFileEnvelope(encrypted.bytes).encrypted, true);
  const locked = await openFileEnvelope(encrypted.bytes, "");
  assert.equal(locked.requiresPassphrase, true);
  await assert.rejects(() => openFileEnvelope(encrypted.bytes, "wrong passphrase"));
  await assert.rejects(() => openFileEnvelope(encrypted.bytes, "x".repeat(257)));
  const opened = await openFileEnvelope(encrypted.bytes, "correct horse battery staple");
  assert.deepEqual(opened.fileBytes, data);
});

test("received metadata is normalized before it reaches the browser", () => {
  assert.equal(sanitizeFilename('../bad\\name:<script>.svg'), '.._bad_name__script_.svg');
  assert.equal(sanitizeMimeType(' Image/PNG '), 'image/png');
  assert.equal(sanitizeMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(sanitizeMimeType('text/html; charset=utf-8'), 'application/octet-stream');
  assert.equal(sanitizeMimeType('not a mime type'), 'application/octet-stream');
});

test("complete optical pipeline rebuilds and verifies an arbitrary file", async () => {
  const original = Uint8Array.from({ length: 61_337 }, (_, index) => (index * 29 + (index >>> 5) + 7) & 0xff);
  const file = new File([original], 'archive.test.bin', { type: 'application/octet-stream', lastModified: 1_725_000_000_000 });
  const envelope = await createFileEnvelope(file, 'a sufficiently long test passphrase');
  const sessionId = createSessionId();
  const blockLength = 640;
  const encoder = new LTEncoder(envelope.bytes, blockLength, sessionSeed(sessionId));
  const decoder = new LTDecoder(encoder.blockCount, blockLength, sessionSeed(sessionId), envelope.bytes.length);

  const sequences = Array.from({ length: Math.ceil(encoder.blockCount * 2.8) }, (_, sequence) => sequence)
    .filter((sequence) => sequence % 9 !== 0)
    .sort((left, right) => ((left % 5) - (right % 5)) || (right - left));

  for (const sequence of sequences) {
    const frame = packFrame({
      sessionId, sequence, blockCount: encoder.blockCount, blockLength, totalLength: envelope.bytes.length,
    }, encoder.encode(sequence));
    const opticalText = FRAME_PREFIX + bytesToBase64Url(frame);
    const parsed = parseFrame(base64UrlToBytes(opticalText.slice(FRAME_PREFIX.length)));
    assert.ok(parsed);
    decoder.addFrame(parsed.header.sequence, parsed.block);
    if (decoder.isComplete) break;
  }

  assert.equal(decoder.isComplete, true);
  const rebuilt = decoder.assemble();
  const opened = await openFileEnvelope(rebuilt, 'a sufficiently long test passphrase');
  assert.equal(opened.requiresPassphrase, false);
  assert.equal(opened.metadata.name, 'archive.test.bin');
  assert.deepEqual(opened.fileBytes, original);
});

test("QR encoder handles the largest built-in frame profile", () => {
  const session = createSessionId();
  const blockLength = 1280;
  const block = new Uint8Array(blockLength);
  crypto.getRandomValues(block);
  const frame = packFrame({ sessionId: session, sequence: 1, blockCount: 2, blockLength, totalLength: 2560 }, block);
  const text = `DOT2:${bytesToBase64Url(frame)}`;
  const qr = createQrMatrix(text, "L");
  assert.ok(qr.size <= 141);
  assert.equal(qr.modules.length, qr.size * qr.size);
  assert.ok(qr.modules.some((value) => value === 1));
  assert.ok(sessionSeed(session) >= 0);
});

test("custom density limits exactly fit every QR correction level", () => {
  const limits = { L: 2171, M: 1704, Q: 1203, H: 911 };
  for (const [correction, maximum] of Object.entries(limits)) {
    const payload = (blockLength) => {
      const encodedLength = Math.ceil((FRAME_HEADER_LENGTH + blockLength) * 4 / 3);
      return `DOT2:${"a".repeat(encodedLength)}`;
    };
    assert.equal(createQrMatrix(payload(maximum), correction).size, 177);
    assert.throws(() => createQrMatrix(payload(maximum + 1), correction));
  }
});
