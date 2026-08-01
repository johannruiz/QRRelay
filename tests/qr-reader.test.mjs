import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createQrMatrix } from "../vendor/qrcode.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readerPath = path.join(root, "vendor", "jsQR.js");
let readerAvailable = true;
try { await access(readerPath); } catch { readerAvailable = false; }

test("bundled software reader decodes the sender's QR output", { skip: !readerAvailable }, async () => {
  const source = await readFile(readerPath, "utf8");
  const context = vm.createContext({ self: {}, Uint8ClampedArray, Uint8Array, ArrayBuffer, console });
  vm.runInContext(source, context, { filename: "vendor/jsQR.js" });
  const decode = context.self.jsQR;
  assert.equal(typeof decode, "function");

  const payload = "DOT2:CAMERA-PERMISSION-TEST-0123456789";
  const { size, modules } = createQrMatrix(payload, "M");
  const quiet = 4;
  const scale = 8;
  const width = (size + quiet * 2) * scale;
  const rgba = new Uint8ClampedArray(width * width * 4);
  rgba.fill(255);

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (!modules[row * size + column]) continue;
      const originX = (column + quiet) * scale;
      const originY = (row + quiet) * scale;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const offset = ((originY + y) * width + originX + x) * 4;
          rgba[offset] = 0;
          rgba[offset + 1] = 0;
          rgba[offset + 2] = 0;
          rgba[offset + 3] = 255;
        }
      }
    }
  }

  const result = decode(rgba, width, width, { inversionAttempts: "dontInvert" });
  assert.equal(result?.data, payload);
});
