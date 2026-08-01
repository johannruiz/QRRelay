# Changelog

## 0.5.0

- Renamed the application to QR Relay across the UI, package metadata, documentation, cache, and runtime messages.
- Removed the header status pills and hosting-provider branding from the interface.
- Removed the session/frame pill that overlapped the QR output.
- Sized the QR canvas against both available width and height, including responsive and full-screen changes.
- Kept decorative corners behind the QR canvas so the full symbol and quiet zone remain unobstructed.

## 0.4.5

- Added a Custom / Lab profile with every payload density from 128 bytes through the correction-specific QR limit.
- Added selectable 1–60 QR/s output and L, M, Q, H error correction.
- Added automatic density ceilings of 2171, 1704, 1203, and 911 bytes for L, M, Q, and H.
- Added live QR module size, raw capacity, density limit, recovery percentage, and optical-risk feedback.
- Raised the theoretical display cap to one QR per refresh, while retaining the practical presets.

## 0.4.4

- Raised the optical profiles to 8, 14, and 20 QR/s with practical 320, 768, and 1280-byte payloads.
- Let the ZXing receiver analyze nearly every available 30 fps camera frame.
- Compacted the desktop workspace so the main controls fit within large browser windows without routine scrolling.
- Moved and condensed receiver progress ahead of the camera on small screens.
- Added a visible attached-file stage with file icon, name, type, size, and a replace action.

## 0.4.3

- Added an embedded ZXing-C++ WebAssembly reader for webcam captures with perspective distortion, monitor moire, and blur.
- Kept jsQR and the native BarcodeDetector as additional local fallbacks.
- Fixed the USB Webcam profile so its configured 2 fps cadence is no longer forced up to 4 fps.
- Verified that ZXing decodes the exact camera frame that remained unreadable in version 0.4.2.

## 0.4.2

- Reduced USB Webcam frames to 128 data bytes, producing 61×61 QR symbols at 2 fps.
- Matched the receiver's actual decode crop to the visible central scan guide.
- Excluded recursive QR reflections and neighboring browser windows from the initial finder-pattern search.

## 0.4.1

- Added a Webcam-first profile with smaller 85×85 QR symbols and a 5 fps cadence.
- Made Webcam the default profile and reduced the density and speed of the other profiles.
- Increased receiver analysis resolution for QR codes occupying only part of a 1080p camera frame.
- Added visible camera-frame diagnostics while the receiver is scanning but has not decoded a transfer QR.
- Bumped the offline cache so deployed clients replace the previous optical settings.

## 0.4.0

- Fixed camera startup so **Start Camera** directly calls `getUserMedia()` and triggers the browser permission prompt.
- Removed the incorrect requirement for native `BarcodeDetector` before requesting camera access.
- Added a bundled jsQR software decoder fallback for iPhone and browsers without native barcode detection.
- Added camera constraint fallback, clearer permission errors, and automatic camera enumeration after access.
- Added a verified GitHub Pages Actions workflow and HTTPS-first documentation.
- Added a service worker for offline reuse after the first successful visit.
- Added an integration test that decodes QR output with the bundled software reader.

## 0.3.0

- Removed the runtime application-server requirement.
- Rebuilt the application as one generated `index.html`.
- Inlined the visual system, protocol, encryption, fountain code, QR encoder, and application logic.
- Replaced module workers with local queued worker-compatible processors.

## 0.2.0

- Rebuilt as one responsive Send/Receive application.
- Added arbitrary file support, metadata preservation, verified download, optional encryption, protocol v2, strict limits, and fountain coding.
