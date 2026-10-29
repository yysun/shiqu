# Desktop internet access E2E

Use disposable data, no credentials, no AI generation. UI uses pnpm desktop:preview and in-app browser; never stage/package desktop resources.

1. With legacy settings, load current native settings: internet is off; start server and verify localhost and advertised LAN reader work without cookies; no tunnel process/public URL. Stop and repeat with port conflict; ownership releases.
2. In preview inspect internet checkbox, helper setup/path, LAN always-on text, private-link guidance and disabled native operations. Verify layout at desktop and narrow widths without personal-data mutations.
3. With installed official helper and temporary seeded library/static reader, enable internet and start runtime. Public QR link must be HTTPS with fragment credential; bare public API/media deny. Open /connect with fragment in in-app browser, exchange Secure/HttpOnly cookie, and reach reader/API/image. Same-origin mutation succeeds without AI; foreign origin, invalid Host and missing credential fail. Streaming NDJSON passes through (no SSE).
4. Stop runtime: helper PID disappears, local and tunnel listener stop, public URL no longer serves reader. Restart: new pairing secret; old cookie/link cannot authenticate the new runtime.
5. Invalid helper path/startup failure produces safe actionable error and no listeners/process/data lock leak. Terminate helper after readiness: local/LAN remain usable, public URL is cleared and native UI status shows internet failure. Parent stdin EOF stops runtime/helper.

Record actual checks/evidence and any external service blockers in plan/done.

## Execution evidence
- Cases 1, 4, 5: automated desktop/internet lifecycle fixtures passed, including both loopback/wildcard port conflicts, public revocation, helper timeout/missing/exit, startup EOF, native disconnect frames, data ownership and LAN persistence.
- Case 3 HTTP boundary: real official cloudflared 2026.10.6 served seeded disposable library over HTTPS; fragment exchange produced Secure/HttpOnly/SameSite cookie; bare API/media 401; native settings 404; foreign Origin 403; same-origin progress write succeeded; reader HTML and 3,215,143-byte image delivered with private,no-store. System resolver returned ENOTFOUND initially; per-request Cloudflare DoH lookup was used without system changes. Incremental NDJSON gate behavior passed an automated stream fixture. Real phone/browser execution remains unverified.
- Case 2 and rendered portions of case 3: BLOCKED. cua inventory/listTabs/getBrowser (including fresh session) report local browser use disabled in Work settings. Existing Vite preview at 127.0.0.1:1420 serves transformed current desktop source. User intends to enable browser access; permission has not become available to tools yet. No separate browser used.
- Native Lite 16/16 and bundled-node 17/17 tests pass. One staged-runtime-only integrity test filtered because desktop/resources/node is absent; resource mapping omitted for tests via TAURI_CONFIG. No app preparation/build/package or Docker build performed.
