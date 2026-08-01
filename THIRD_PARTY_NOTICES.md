# Third-party notices

## QRCode for JavaScript

`vendor/qrcode.js` contains a local ESM bundle derived from **QRCode for JavaScript** by Kazuhiko Arase, copyright 2009. The source carries the MIT license. The complete notice is in `vendor/QR_ENCODER_LICENSE.txt`.

## jsQR

The production build embeds **jsQR 1.4.0** by Cosmo Wolfe and contributors, licensed under Apache-2.0. The build fetches the immutable Git blob `99ea9df26907009e5553233ffe03c529c1521739` and verifies that Git object SHA before use. The complete license is in `vendor/JSQR_LICENSE.txt`.

## zxing-wasm

The production build embeds the **zxing-wasm 3.1.2** QR reader, licensed under MIT. Its ZXing-C++ WebAssembly binary is inlined in the generated HTML as a data URL. The complete package license is in `vendor/ZXING_WASM_LICENSE.txt`.

No third-party code is fetched by the published application at runtime.
