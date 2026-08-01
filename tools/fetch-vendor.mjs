import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, "vendor", "jsQR.js");
const expectedBlobSha = "99ea9df26907009e5553233ffe03c529c1521739";
const endpoint = `https://api.github.com/repos/cozmo/jsQR/git/blobs/${expectedBlobSha}`;

function gitBlobSha(buffer) {
  return createHash("sha1")
    .update(Buffer.from(`blob ${buffer.length}\0`, "utf8"))
    .update(buffer)
    .digest("hex");
}

function validate(buffer) {
  if (gitBlobSha(buffer) !== expectedBlobSha) return false;
  const source = buffer.toString("utf8");
  return source.includes("webpackUniversalModuleDefinition")
    && source.includes("function jsQR(data, width, height")
    && source.length > 200_000;
}

try {
  const existing = await readFile(destination);
  if (validate(existing)) {
    console.log("Vendored jsQR is already present and verified.");
    process.exit(0);
  }
} catch {
  // Fetch the pinned immutable Git blob below.
}

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "qr-relay-build",
};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const response = await fetch(endpoint, { headers });
if (!response.ok) throw new Error(`Could not download pinned jsQR source (${response.status} ${response.statusText}).`);
const payload = await response.json();
if (payload.encoding !== "base64" || typeof payload.content !== "string") throw new Error("GitHub returned an unexpected jsQR blob response.");
const buffer = Buffer.from(payload.content.replace(/\s+/gu, ""), "base64");
if (!validate(buffer)) throw new Error("Downloaded jsQR did not match the pinned Git blob SHA.");

await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, buffer);
console.log(`Downloaded and verified vendor/jsQR.js (${buffer.length.toLocaleString("en-US")} bytes).`);
