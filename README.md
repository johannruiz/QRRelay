# QR Relay

QR Relay transfers any file from one screen to another device's camera through animated QR codes. The payload is processed locally and is never uploaded to a backend. Version 0.5.0 can be published as a static HTTPS site so the browser receives a stable secure origin and can request camera permission reliably.

## Why GitHub Pages is used

There is still no application server, database, account system, or upload endpoint. GitHub Pages only serves the static files over HTTPS. The camera permission dialog is triggered when the user taps **Start Camera** and the app calls `navigator.mediaDevices.getUserMedia()`.

Opening a downloaded HTML file may work for sending, but camera behavior from `file://` is inconsistent across browsers. Use the GitHub Pages URL for receiving.

## Publish

1. Upload this project to the root of a GitHub repository with `main` as its default branch.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. Push to `main`, or run **Deploy GitHub Pages** manually from the **Actions** tab.
5. Open the generated `https://<user>.github.io/<repository>/` address.

The included workflow downloads a pinned immutable jsQR Git blob, verifies its Git object SHA, builds a single `index.html`, runs the tests, and publishes `index.html` plus `sw.js`.

## Use

1. Open the published HTTPS address on both devices.
2. Choose **Send** on one device and **Receive** on the other.
3. On the receiver, tap **Start Camera** and choose **Allow** when the browser asks.
4. Select any file on the sender and tap **Start Display**.
5. Keep the complete QR inside the receiver guide until verification finishes.

For USB webcams aimed at a monitor, start with **USB Webcam** mode. It uses an 85×85 QR at 8 fps. **Balanced** runs at 14 fps and **Fast** at 20 fps. The embedded ZXing reader and central scan region keep these profiles practical with monitor moire, refresh tearing, autofocus blur, and recursive QR reflections.

**Custom / Lab** exposes every integer payload density supported by the current QR text protocol, speeds from 1 to 60 QR/s, and error correction L, M, Q, or H. The density ceiling changes automatically: 2171 bytes at L, 1704 at M, 1203 at Q, and 911 at H. The interface reports actual QR modules, theoretical raw capacity, correction-specific limit, and optical risk. These are laboratory bounds rather than guaranteed camera throughput.

After the first successful visit, the service worker caches the application for offline reuse. Camera permission remains controlled by the browser and operating system.

## Camera compatibility

Receiving requires a secure context and `getUserMedia()`. The app first uses the browser's native `BarcodeDetector` when available, then an embedded ZXing-C++ WebAssembly reader, and finally jsQR. ZXing-C++ handles the perspective, display moire, and blur commonly produced by a USB webcam aimed at a monitor. All readers run locally.

When permission was denied previously:

- Desktop Chrome: open the site controls beside the address, set **Camera** to **Allow**, then reload.
- iPhone: open **Settings → Privacy & Security → Camera**, enable camera access for Chrome, then reopen the page and tap **Start Camera**.

The prompt cannot be granted automatically: browsers require a user decision.

## Features

- One interface for Send and Receive, with mode switching at any time.
- Static GitHub Pages deployment; no backend and no payload network transfer.
- Offline reuse after the first successful HTTPS visit.
- Any file format up to the 128 MiB safety limit.
- Preserves file name, MIME type, modification date, and binary contents.
- Fountain coding tolerates missing, repeated, and out-of-order QR frames.
- CRC-32 per optical frame and SHA-256 verification before download.
- Optional AES-256-GCM passphrase protection with PBKDF2-SHA-256.
- Random 128-bit sessions, strict receiver locking, camera selection, reset, full screen, wake lock, and safe previews.

## Security model

CRC-32 rejects accidental optical corruption. SHA-256 verifies the reconstructed file before download. Optional passphrase mode encrypts the file container with AES-256-GCM. QR Relay does not authenticate the sender and cannot prevent someone with line of sight from recording the QR stream; use a strong passphrase for sensitive files.

## Development

No package installation is required.

```bash
npm run vendor
npm run verify
```

`npm run vendor` retrieves only the pinned jsQR blob. `npm run verify` builds the published HTML, checks its structure and runtime references, tests the QR reader, and runs the protocol, encryption, fountain-code, and end-to-end tests.

## Project structure

```text
.github/workflows/deploy-pages.yml  Verified GitHub Pages build and deploy
index.template.html                 Readable interface template
styles.css                          Visual system
src/app.js                          UI, camera permission, sender, receiver
src/portable-workers.js             Local queued processors
src/core/                           Protocol, fountain code, envelope, base64
vendor/qrcode.js                    Local QR encoder
vendor/jsQR.js                      Generated pinned QR reader (build-time)
vendor/zxing-reader.js              Embedded ZXing-WASM reader
vendor/zxing_reader.wasm            Embedded ZXing-C++ binary
tools/fetch-vendor.mjs              Downloads and verifies the pinned reader
tools/build-portable.mjs            Builds one inlined index.html
tools/check.mjs                     Static/runtime checks
sw.js                               Offline cache after first visit
tests/                              Core and QR-reader tests
```

## License

MIT. Third-party QR components retain their original licenses; see `THIRD_PARTY_NOTICES.md`.
