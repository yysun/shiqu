# Phone access QR on startup

## Summary

- `pnpm start` now listens on `0.0.0.0:3000` by default and prints LAN browser URLs with terminal QR codes after the server starts listening. Explicit `SHIQU_BIND_IP` and `PORT` settings remain supported.
- `pnpm dev` exposes the Vite frontend on the LAN and prints QR codes for its browser URLs. Its API stays on loopback and remains available through Vite's same-origin proxy.
- The shared renderer uses `qrcode-terminal`; the runtime dependency and TypeScript declarations are pinned in the pnpm lockfile. The README explains phone access and how to restore a localhost-only production bind.

## Verification

- Node 24.22.1 and pnpm 11.25.0.
- During implementation, `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `git diff --check` passed.
- `pnpm exec node --experimental-strip-types --test tests/local-server.test.mjs`: all seven persistence, HTTP, media, concurrency, and import tests passed.
- Production smoke test launched `pnpm start` with temporary data and an available custom port. Confirmed the default LAN bind, terminal QR output, and HTTP 200 responses for the frontend and `/api/stories` through the advertised LAN URL. A second launch with `SHIQU_BIND_IP=127.0.0.1` confirmed local HTTP access and no phone QR output.
- Restarted `pnpm dev` during the session and observed its LAN URL `http://10.0.0.2:3000/` and QR code. Requests through that URL returned HTTP 200 for both the frontend and proxied API. This records the session's successful run, not a promise that the process remains running or the address remains assigned.
- Reused the implementation review: `CR passed: no major findings`.

### Final VR result

VR risk: low — localized startup output and LAN binding changes with explicit localhost configuration preserved.

VR review round: 1; reviewer: not applicable

- Complete: native production startup prints the LAN URL and terminal QR code after listening; verified with an actual `pnpm start` process.
- Complete: development startup prints the frontend URL and QR code; verified during the requested restart of `pnpm dev`.
- Complete: advertised LAN URLs use the configured browser port, with the frontend and API reachable through that origin; production custom-port and development default-port checks passed.
- Complete: explicit production localhost binding remains available and suppresses the phone QR code; verified in the production smoke test.

VR passed: all acceptance criteria complete

## Notes

- Phone access requires a reachable network interface, the same accessible LAN, and any necessary host firewall allowance. Physical iPhone scanning was left to the user and was not observed.
- The application has no login isolation. Default native LAN binding makes it accessible to other devices on that network; the README documents use on trusted networks.
- Docker phone access is not part of this delivery. Compose still publishes only on localhost, and QR discovery inside a container would find its internal address. A host URL override and a reachable published port are still needed. No Docker image was built or tested.
- Pre-existing Codex model changes in `.env.example` and separate README hunks are excluded from this delivery commit.
