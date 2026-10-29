# Direct reader access E2E

1. Run `pnpm desktop:preview`, open its existing in-app browser tab and inspect Settings. Copy/QR labels and network note must describe direct access and contain no re-pair instruction. Browser preview cannot start native services.
2. Start a desktop listener against disposable data without provider credentials. Open its root origin in the in-app browser with no pairing cookie. Reader content and stories API succeed. Write progress, stop/restart on the same port and reload the same URL: progress remains and no pairing is needed. Native settings routes stay unavailable.
3. Run the development proxy against disposable files. API reads/writes require no cookie; foreign Host/Origin requests are rejected and Vite private/raw/@fs paths stay blocked. Desktop LAN sharing off still binds loopback. QR origins are plain IP/port.

Use automated HTTP integration evidence for proxy/private-file boundaries and browser evidence for the preview/direct navigation. No package build, paid generation or claim of physical phone testing.
