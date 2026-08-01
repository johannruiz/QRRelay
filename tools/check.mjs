import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceFiles = walk(root).filter((file) => [".js", ".mjs"].includes(extname(file)));
let failed = false;

for (const file of sourceFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) report(`Syntax error in ${relative(root, file)}\n${result.stderr}`);
}

const html = readFileSync(join(root, "index.html"), "utf8");
if (!html.includes("QR RELAY / V0.5.0")) report("QR Relay version marker is missing.");
if (!html.includes("<style>")) report("The stylesheet is not inlined.");
if (/type=["']module["']/iu.test(html)) report("The built HTML still uses JavaScript modules.");
if (/\bnew\s+Worker\s*\(/u.test(html)) report("The built HTML still requires an external Worker.");
if (!html.includes("function jsQR(data, width, height")) report("The bundled software QR reader is missing.");
if (!html.includes("ZXingWASM")) report("The bundled ZXing-WASM QR reader is missing.");
if (!html.includes("data:application/wasm;base64,")) report("The embedded ZXing WebAssembly binary is missing.");
if (!html.includes("navigator.mediaDevices.getUserMedia")) report("The camera permission request is missing.");
if (!html.includes("softwareQrDecoder")) report("The software QR fallback integration is missing.");
if (!html.includes('id="fileReadyStage"')) report("The attached-file stage is missing.");
if (!html.includes('fps: 20')) report("The fast 20 QR/s profile is missing.");
if (!html.includes('id="customProfilePanel"')) report("The custom optical profile controls are missing.");
if (!html.includes('max="60"')) report("The theoretical 60 QR/s control is missing.");
if (!html.includes('H · 30% recovery')) report("The complete QR correction-level controls are missing.");
if (html.includes(["DE", "CIM", "EN"].join(""))) report("The previous product name is still present in the UI.");
if (/GITHUB PAGES/iu.test(html)) report("A hosting-provider label is still present in the UI.");
if (html.includes('id="qrOverlay"')) report("The QR-obscuring overlay is still present.");
if (html.includes("LOCAL ONLY") || html.includes("ONLINE SESSION")) report("The removed header status pills are still present.");
if (!html.includes("Math.min(920, availableWidth, availableHeight)")) report("The two-axis QR canvas sizing fix is missing.");
if (!html.includes("new ResizeObserver")) report("Responsive QR canvas resizing is missing.");

checkHtmlIds(html);
checkRuntimeReferences(html);
checkInlineScripts(html);

if (failed) process.exit(1);
console.log(`Checked ${sourceFiles.length} JavaScript files and the QR Relay runtime.`);

function checkHtmlIds(markup) {
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) report(`Duplicate HTML IDs: ${[...new Set(duplicates)].join(", ")}`);
  const known = new Set(ids);
  for (const match of markup.matchAll(/\s(?:for|aria-controls|aria-labelledby|aria-describedby|data-toggle-password)="([^"]+)"/g)) {
    for (const id of match[1].split(/\s+/u)) {
      if (id && !known.has(id)) report(`HTML references missing ID: ${id}`);
    }
  }
}

function checkRuntimeReferences(markup) {
  for (const match of markup.matchAll(/<(?:script|link|img|source)\b[^>]*\s(?:src|href)="([^"]+)"/giu)) {
    const target = match[1];
    if (target !== "#" && !target.startsWith("data:") && !target.startsWith("blob:")) {
      report(`Built HTML depends on another runtime resource: ${target}`);
    }
  }
  if (/\b(?:fetch|importScripts)\s*\(\s*["'](?:https?:|\.\/|\.\.\/)/iu.test(markup)) {
    report("Built HTML contains a runtime network or file fetch.");
  }
}

function checkInlineScripts(markup) {
  const scripts = [...markup.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)].map((match) => match[1]);
  if (scripts.length !== 1 || scripts[0].trim().length === 0) {
    report(`Expected one non-empty inline script, found ${scripts.length}.`);
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "qr-relay-check-"));
  const file = join(directory, "bundle.js");
  try {
    writeFileSync(file, scripts[0]);
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) report(`Syntax error in the built inline bundle\n${result.stderr}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function report(message) {
  failed = true;
  console.error(message);
}

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const file = join(directory, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
}
