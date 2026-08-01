import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFile(path.join(root, file), 'utf8');

function stripModule(source) {
  return source
    .replace(/^\s*import\s+[^;]+;\s*$/gmu, '')
    .replace(/\bexport\s+(?=(?:async\s+)?function\b|class\b|const\b|let\b|var\b)/gu, '');
}

const html = await read('index.template.html');
const css = await read('styles.css');
const base64 = stripModule(await read('src/core/base64.js'));
const protocol = stripModule(await read('src/core/protocol.js'));
const fountain = stripModule(await read('src/core/fountain.js'));
const envelope = stripModule(await read('src/core/envelope.js'));
const qrcode = stripModule(await read('vendor/qrcode.js'));
const jsqr = await read('vendor/jsQR.js');
const zxingReader = await read('vendor/zxing-reader.js');
const zxingWasm = await fs.readFile(path.join(root, 'vendor/zxing_reader.wasm'));
const zxingWasmDataUrl = `data:application/wasm;base64,${zxingWasm.toString('base64')}`;
let app = stripModule(await read('src/app.js'));
const localWorkers = await read('src/portable-workers.js');

const bundle = `(() => {\n"use strict";\n${base64}\n${protocol}\n${fountain}\n${envelope}\n${qrcode}\n${jsqr}\n${zxingReader}\nglobalThis.ZXingWASM = typeof ZXingWASM === "object" ? ZXingWASM : globalThis.ZXingWASM;\nconst ZXING_READER_WASM_DATA_URL = ${JSON.stringify(zxingWasmDataUrl)};\n${localWorkers}\n${app}\n})();`.replaceAll("</script", "<\\/script");

let output = html
  .replace(/\s*<link rel="manifest"[^>]*>\s*/u, '\n')
  .replace(/\s*<link rel="icon"[^>]*>\s*/u, '\n')
  .replace(/\s*<link rel="stylesheet" href="\.\/styles\.css">\s*/u, () => `\n<style>\n${css}\n</style>\n`)
  .replace('<a class="brand" href="./"', '<a class="brand" href="#"')
  .replace('<script type="module" src="./src/app.js"></script>', () => `<script>\n${bundle}\n</script>`);

await fs.writeFile(path.join(root, 'index.html'), output);
console.log(`Built QR Relay index.html (${Buffer.byteLength(output).toLocaleString('en-US')} bytes)`);
