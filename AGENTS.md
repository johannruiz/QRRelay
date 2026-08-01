# Working on QR Relay

QR Relay is a static web application. Preserve these invariants:

- No backend, telemetry, accounts, payload upload, or runtime CDN dependency.
- Camera permission must be requested only from an explicit user action.
- Native `BarcodeDetector` is optional; keep the bundled software reader fallback working.
- Published app logic and styles remain in one generated `index.html`; `sw.js` only provides offline caching.
- Treat camera output, QR frames, metadata, filenames, and reconstructed bytes as hostile input.
- Keep allocations behind protocol limits and verify SHA-256 before exposing a download.

Common commands:

```bash
npm run vendor   # fetch and verify pinned vendor/jsQR.js
npm run build    # produce index.html
npm run check    # syntax and generated-runtime checks
npm test         # protocol and QR-reader tests
npm run verify   # full build/check/test pipeline
```

Do not edit generated `index.html` or `vendor/jsQR.js` directly. Edit `index.template.html`, `styles.css`, and files under `src/`, then rebuild.
