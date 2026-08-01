# Architecture

## Published runtime

GitHub Pages serves two static files over HTTPS:

- `index.html`: the complete interface, visual system, protocol, crypto, fountain code, QR encoder, software QR reader, and application logic.
- `sw.js`: a same-origin service worker that caches the application after the first successful visit.

There is no backend and the transferred payload is never sent through GitHub Pages. HTTPS exists only so browsers can establish a stable origin and expose camera permission APIs.

## Build path

Readable source remains split for maintenance. `tools/fetch-vendor.mjs` downloads the immutable jsQR Git blob `99ea9df26907009e5553233ffe03c529c1521739`, recomputes its Git object SHA, and writes `vendor/jsQR.js`. `tools/build-portable.mjs` removes local module syntax, combines sources in dependency order, inlines CSS and JavaScript, and writes `index.html`.

The GitHub Pages workflow builds and tests on every push to `main`, then publishes only `index.html`, `sw.js`, and `.nojekyll`.

## Data path

1. The sender reads the selected `File` locally.
2. `envelope.js` stores sanitized metadata, bytes, and SHA-256. Optional passphrase mode encrypts the private container with AES-256-GCM after PBKDF2-SHA-256 key derivation.
3. The sender processor splits the envelope into fixed source blocks and emits deterministic LT fountain combinations.
4. `protocol.js` adds a random 128-bit session ID, sequence, strict dimensions, and CRC-32. The frame becomes `DOT2:` plus base64url and is encoded as a QR matrix.
5. After a direct user click, the receiver calls `getUserMedia()` and the browser displays its permission prompt.
6. The receiver tries native `BarcodeDetector` when available, then falls back to the inlined jsQR reader using canvas RGBA pixels.
7. Valid frames are locked to one session and queued for fountain decoding.
8. The decoder reconstructs all source blocks despite expected loss, duplicates, and reordering.
9. `envelope.js` decrypts when required and verifies SHA-256 before creating a download URL.

## Browser boundary

The application cannot grant camera permission itself. It can only request permission from a top-level HTTPS page in response to user interaction. The browser and operating system remain the authority. A prior denial must be changed in site or system settings.

Native barcode detection is an optimization, not a requirement. The local software reader is always bundled in the production build so iPhone and browsers without `BarcodeDetector` can still scan.

## Trust boundaries

QR text, frame headers, reconstructed metadata, filenames, MIME strings, camera results, and passphrases are untrusted. Limits are checked before allocation. Active document formats are download-only; only safe raster images, media, and small plain text receive automatic previews.
