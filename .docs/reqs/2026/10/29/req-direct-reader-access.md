# Direct reader access

Repeated pairing interrupts ordinary phone reading. Use only IP and port for both the local development server and desktop reader; scanning a QR opens the same address a user can type.

- [x] Desktop status, QR and copied links contain an HTTP origin only, without pairing paths, tokens or cookies.
- [x] Local development prints plain IP/port links and QR codes; its proxied API works without pairing.
- [x] Reader, stories, media and progress work without cookies before and after service restart; persisted progress survives.
- [x] Preserve Host/Origin checks, the desktop LAN opt-in, Vite private-file restrictions and isolation of native settings/keys.
- [x] UI, README and affected verification scripts describe direct access and its consequence: reachable LAN devices share the library and generation permissions.

No persistent device identity, login replacement, Docker build or desktop packaging. Existing unrelated reader edits stay untouched. No blocking questions: the user explicitly requested IP/port access for both server and desktop.
