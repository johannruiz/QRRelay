# Security

## Reporting

Do not publish files, passphrases, or recorded QR streams in a public issue. Report a suspected security defect privately to the project maintainer with a minimal reproduction and browser/device details.

## Boundaries

- CRC-32 detects frame corruption; it is not an authentication primitive.
- SHA-256 verifies reconstructed file integrity against the digest carried inside the file envelope.
- AES-256-GCM passphrase mode protects confidentiality and detects tampering with the protected envelope.
- The project does not authenticate the human or device operating the sender.
- Browser, operating-system, camera, display, and physical-surveillance security remain outside the application boundary.
