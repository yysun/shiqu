# Desktop internet access

Story base: `d9a24291c37564bc7264b40fc6ae7ab865f799dd`. Initial working tree clean. Risk: non-low (public exposure, authentication, helper lifecycle and native settings).

## Design
Keep existing local/LAN access gate; always bind its reader to 0.0.0.0 and advertise LAN addresses. A second ephemeral loopback listener is the tunnel target and applies authentication before any application route. Accept only the assigned public Host, reconstruct its HTTPS origin for existing same-origin checks, and ignore forwarded headers. QR link uses a random fragment secret; /connect exchanges it via same-origin POST for Secure/HttpOnly/SameSite cookie, then removes fragment and opens reader. Override every remote response to private,no-store (including assets/media/bootstrap) to prevent shared-cache auth bypass. Separate random cookie secret, bounded lifetime, no persistence; stop invalidates both. No secrets in process arguments, helper environment or logs. Tunnel process uses minimal environment, explicit isolated empty config, no shell, no auto update. Discover existing helper via supplied path, PATH and standard install paths. Wait for assigned HTTPS hostname and registered connection with bounded timeout; helper failure stops tunnel target and clears public status; local/LAN should remain usable if helper exits after startup. Native status must reflect updates without exposing remote management. Startup failure leaves no processes/listeners/locks and reports an actionable safe error. Parent EOF/signals abort in-flight startup immediately via AbortSignal; helper terminates within native 8-second stop grace even while startup is pending. Native status consumes bounded JSON-line updates so helper exit clears public URL while local/LAN remain active.

## Tasks
- [x] SS feasibility probe: obtain official cloudflared in a temporary folder, confirm flags/config isolation, Host preservation, HTTPS public /connect reachability and shutdown against a disposable non-library server. Stop dependent work if incompatible.
- [x] Implement authenticated remote gate and supervised helper, covering failure, bounded startup, shutdown and isolated credentials; integrate desktop backend with always-on LAN and dynamic remote status.
- [x] Update native settings (safe legacy migration), status transport/start timeout and UI toggle/path/QR/LAN controls; retain provider/private commands.
- [x] Add auth/lifecycle/native migration regression tests; update smoke expectations and user/developer docs.
- [x] TT: pnpm test, pnpm typecheck, pnpm lint; native tests both feature modes where existing resources permit, cargo fmt --check.
- [ ] ET: execute .docs/tests/test-desktop-internet-access.md using in-app preview and disposable tunnel fixture. No actual personal library exposure or paid requests.

## Validation and risks
Automated cases cover unpaired assets/API/media; wrong secret/cookie/origin/host; secret-free bootstrap; signed-in GET/POST; fresh secrets on restart; missing/crashed/timed-out helper; helper shutdown/EOF; LAN retained when internet disabled; old settings never silently enable internet. Live tunnel verifies actual HTTPS origin/Host/cookie/streaming with seeded test library only. Quick Tunnels have no uptime SLA, changing hostname, 200 concurrent requests and no SSE (reader uses NDJSON/polling). Internet traffic traverses Cloudflare; LAN remains unencrypted trusted access. GUI PATH may differ; optional absolute helper path avoids ambiguity. Rust start timeout must cover bounded tunnel startup; server-status changes must reach native UI. No automatic reconnect/new URL after helper death; explicit stop/start retries.

## Review/evidence
AR passed: no blocking architecture flaws

AR risk: non-low — public exposure, pairing sessions, helper supervision, native migration.
AR review round: 1; reviewer: new (independent internet_review).

SS probe: official cloudflared 2026.10.6 darwin-arm64 archive SHA-256 ea1e5105d35bbe16cee5b2f7b4742059ada341fbd35938ed827c24b85efa51c8 verified against GitHub release metadata. Isolated empty config accepted; public HTTPS request returned original public Host; SIGTERM closed helper. ISP resolver initially returned ENOTFOUND; Cloudflare DoH plus curl --resolve validated real TLS/HTTP through tunnel without modifying system DNS. No personal library exposed.

SS evidence: desktop reader always binds 0.0.0.0; remote listener is separate and gated. Native migrated settings default internet off, retains ignored legacy LAN input and validates helper path. JSON-line updates revoke QR on helper death while LAN survives. UI toggle is internet-only; selector retains LAN links. README and desktop README cover install, privacy, lifetime and limitations. Smoke contract updated without staging/building payloads.

TT evidence (Node 24.22.1, pnpm 11.25.0, Rust 1.93.0/macOS arm64): pnpm test passed 246/246; after two additional protocol/NDJSON tests, focused desktop-internet passed 10/10. pnpm typecheck, pnpm lint, cargo fmt --check passed. Native Lite 15/15 and bundled-node 16/16 passed using TAURI_CONFIG resource override to omit absent node resources. The bundled-runtime byte validation test was explicitly filtered because no staged Node exists; no preparation/build/package command was run. Initial unoverridden native test correctly reported missing desktop/resources/node; subsequent tests only suppress that absent resource mapping, not production integrity checks.

ET HTTP evidence: official cloudflared 2026.10.6 with disposable seeded SQLite and existing public client build served real public HTTPS bootstrap, authenticated HTML, API and 3,215,143-byte seed image; bare API/media 401; private,no-store and secure cookie verified; same-origin progress POST succeeded; foreign Origin 403; native settings 404; stop closed local access/helper. Per-request Cloudflare DoH lookup worked around the host ISP resolver returning ENOTFOUND without changing system DNS. No paid calls or personal library exposure. Pairing fragment not printed/logged. NDJSON incremental gate behavior and actual native disconnect/EOF protocol are automated fixtures.

ET visual check pending: existing pnpm desktop:preview on 127.0.0.1:1420 serves current source, but cua inventory/listTabs report "Local browser use is disabled in Work settings". User asked asynchronously to enable browser access or accept visual verification incomplete. No separate browser session or package was used.

SS milestone: `a5c81b0` (feature, tests, migration and docs). Verification status as recorded above; no packaging or push. Existing desktop preview module was fetched from 127.0.0.1:1420/main.tsx and contains internet toggle, always-on LAN copy, helper setting and private copy action; this confirms Vite serves the changed module, not rendered visual behavior. Temporary real/fake tunnel processes are stopped.

CR round 1: CR blocked: error-only runtime frames can crash the desktop UI. Independent reviewer found that Node fatal diagnostics may precede asynchronous shutdown, so replacing the complete status with {error} violates React phoneUrls requirements. Fixed by normalizing error frames to a complete stopped status; added readiness-then-fatal-error Rust regression. Also restored/preserved loopback port-conflict coverage alongside wildcard conflicts: macOS permits wildcard bind coexistence, so desktop startup now probes its advertised loopback endpoint before binding LAN. This preserves the original conflict contract rather than weakening the test.

Post-fix evidence: focused Node desktop/internet tests 17/17; native Lite 16/16; typecheck/lint/fmt pass. User has said they will enable browser access; first retry still reported disabled, so rendered ET remains pending.

CR fixed: fatal-error frames now retain a complete stopped-status shape; rerun result passed.
CR risk: non-low — public authentication, helper lifecycle, native status transport and settings migration.
CR review round: 2; reviewer: reused (independent internet_review).

README final pass (requested by user before final commit): added network choice comparison, tunnel-vs-AI cost distinction, 45-second startup expectation and startup-failure LAN recovery. No implementation changes after review repair. Browser access still reports disabled on retry despite user intent to enable it.

Latest native evidence after CR repair: Lite 16/16, bundled-node 17/17 with the same single staged-runtime-only test filtered. Remaining ET task is rendered in-app UI, not HTTP or lifecycle verification. REQ 1/2/4/5 checked; REQ 3/6 remain unchecked until browser evidence exists.

## Final validation status

VR incomplete: acceptance criteria 3 and 6 lack rendered in-app-browser evidence; the ET plan task remains incomplete.

VR risk: non-low — public authentication, helper lifecycle, native status transport and settings migration.
VR review round: 2; reviewer: reused

1. **Complete — LAN always on.** The main desktop reader binds to `0.0.0.0`, retains direct localhost/LAN access, and advertises discovered LAN addresses. Lifecycle tests cover library persistence, LAN availability and both loopback/wildcard port conflicts.

2. **Complete — Free, opt-in internet access.** Native and Node settings default internet access off; legacy `lanEnabled` values cannot enable it. Tests cover migration and persistence. The official `cloudflared` feasibility probe and live HTTPS fixture demonstrate an accountless Quick Tunnel without a purchased domain.

3. **Incomplete — Rendered QR/link controls.** Implementation provides the public HTTPS pairing link, QR generation, copy action and LAN selector. Native protocol and live HTTP evidence support the link contract. README and desktop guidance cover helper installation, changing URLs, uptime, permissions and free-service limits. Actual rendered controls and QR behavior remain unverified because in-app browsing is disabled.

4. **Complete — Public authentication and origin protection.** Tests cover cryptographic pairing/session separation, twelve-hour expiry, unpaired reader/API/media denial, native-route rejection, Host/Origin validation and forwarded-header handling. Live HTTPS evidence confirms secure cookie exchange, same-origin progress updates and foreign-origin denial. Remote responses uniformly prevent shared caching.

5. **Complete — Cleanup and failure handling.** Fixtures cover missing/timed-out helpers, startup cancellation, parent EOF, helper termination, public revocation, native disconnect updates and continued LAN access. CR round 2 passed after fatal-error frames were normalized to a complete stopped-status shape; the new Rust regression protects the React contract.

6. **Incomplete — Overall verification.** Recorded evidence includes the earlier full Node suite, latest focused Node checks 17/17, native Lite 16/16, bundled-node subset 17/17, typecheck, lint and formatting. Real HTTPS delivered disposable reader HTML, API data and the 3,215,143-byte seed image without paid generation or personal-library exposure. Required in-app-browser verification remains unavailable. One staged-runtime integrity test remains explicitly filtered because bundled Node resources are absent; no preparation, packaging or Docker build occurred.

README verified by independent reviewer against final implementation. Source milestones a5c81b0 and e4d49a2 are local commits; final documentation commit records README and incomplete browser verification. RPD is not represented as fully passed.
