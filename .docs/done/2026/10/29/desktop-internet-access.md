# Desktop internet access — source implemented; browser validation pending

## Summary

Replace the LAN checkbox with an optional free Cloudflare Quick Tunnel. LAN remains on. The public QR contains a private fragment pairing credential; a separate loopback gateway requires a Secure/HttpOnly session before reader/API/media access. Tunnel disconnect removes public access while LAN remains available; startup cancellation and exit clean up helper processes. Old LAN settings cannot silently enable internet exposure. The README now explains setup, network choice, cost, private links, changing URLs and failure recovery.

## Verification

AR passed and independent CR round 2 passed after repairing fatal-error status normalization. Node full suite passed 246/246 before two extra protocol/stream tests; latest affected desktop tests passed 17/17. Native Lite 16/16 and bundled-node subset 17/17 pass, plus typecheck/lint/fmt. One test requiring staged bundled Node bytes was filtered because those resources are absent; resource mapping was omitted for test compilation only. Official cloudflared 2026.10.6 (verified release archive SHA-256) served disposable seeded reader HTML, authenticated API and a 3 MB image over actual HTTPS, with progress writes and public/foreign-origin denials. No paid AI calls or personal-library exposure. System DNS initially returned ENOTFOUND; the live fixture used Cloudflare DoH per request without changing host DNS.

The existing Vite preview serves updated source at 127.0.0.1:1420, but CUA still reports browser use disabled, including after a fresh session. The user intends to enable it; rendered desktop/QR and real browser pairing checks remain outstanding. No substitute browser, app packaging, Docker build or push was performed.

## Notes

Both editions require a separately installed cloudflared; macOS setup is `brew install cloudflared`, with optional absolute executable path in the panel. Free temporary URLs change per start, sessions expire after twelve hours and stop revokes access. Source milestones: a5c81b0, e4d49a2. README updated before final documentation commit as requested. RPD remains incomplete pending rendered ET/VR evidence; source and verification state are preserved for continuation.

## Final VR result

VR incomplete: acceptance criteria 3 and 6 lack rendered in-app-browser evidence; the ET plan task remains incomplete.

VR risk: non-low — public authentication, helper lifecycle, native status transport and settings migration.
VR review round: 2; reviewer: reused

1. **Complete — LAN always on.** The main desktop reader binds to `0.0.0.0`, retains direct localhost/LAN access, and advertises discovered LAN addresses. Lifecycle tests cover library persistence, LAN availability and both loopback/wildcard port conflicts.

2. **Complete — Free, opt-in internet access.** Native and Node settings default internet access off; legacy `lanEnabled` values cannot enable it. Tests cover migration and persistence. The official `cloudflared` feasibility probe and live HTTPS fixture demonstrate an accountless Quick Tunnel without a purchased domain.

3. **Incomplete — Rendered QR/link controls.** Implementation provides the public HTTPS pairing link, QR generation, copy action and LAN selector. Native protocol and live HTTP evidence support the link contract. README and desktop guidance cover helper installation, changing URLs, uptime, permissions and free-service limits. Actual rendered controls and QR behavior remain unverified because in-app browsing is disabled.

4. **Complete — Public authentication and origin protection.** Tests cover cryptographic pairing/session separation, twelve-hour expiry, unpaired reader/API/media denial, native-route rejection, Host/Origin validation and forwarded-header handling. Live HTTPS evidence confirms secure cookie exchange, same-origin progress updates and foreign-origin denial. Remote responses uniformly prevent shared caching.

5. **Complete — Cleanup and failure handling.** Fixtures cover missing/timed-out helpers, startup cancellation, parent EOF, helper termination, public revocation, native disconnect updates and continued LAN access. CR round 2 passed after fatal-error frames were normalized to a complete stopped-status shape; the new Rust regression protects the React contract.

6. **Incomplete — Overall verification.** Recorded evidence includes the earlier full Node suite, latest focused Node checks 17/17, native Lite 16/16, bundled-node subset 17/17, typecheck, lint and formatting. Real HTTPS delivered disposable reader HTML, API data and the 3,215,143-byte seed image without paid generation or personal-library exposure. Required in-app-browser verification remains unavailable. One staged-runtime integrity test remains explicitly filtered because bundled Node resources are absent; no preparation, packaging or Docker build occurred.
