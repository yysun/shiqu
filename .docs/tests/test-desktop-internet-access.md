# Desktop internet access E2E

Use disposable data, no credentials, no AI generation. UI uses pnpm desktop:preview and in-app browser; never stage/package desktop resources.

1. With legacy settings, load current native settings: internet is off; start server and verify localhost and advertised LAN reader work without cookies; no tunnel process/public URL. Stop and repeat with port conflict; ownership releases.
2. In preview inspect internet checkbox, helper setup/path, LAN always-on text, private-link guidance and disabled native operations. Verify layout at desktop and narrow widths without personal-data mutations.
3. With installed official helper and temporary seeded library/static reader, enable internet and start runtime. Public QR link must be HTTPS with fragment credential; bare public API/media deny. Open /connect with fragment in in-app browser, exchange Secure/HttpOnly cookie, and reach reader/API/image. Same-origin mutation succeeds without AI; foreign origin, invalid Host and missing credential fail. Streaming NDJSON passes through (no SSE).
4. Stop runtime: helper PID disappears, local and tunnel listener stop, public URL no longer serves reader. Restart: new pairing secret; old cookie/link cannot authenticate the new runtime.
5. Invalid helper path/startup failure produces safe actionable error and no listeners/process/data lock leak. Terminate helper after readiness: local/LAN remain usable, public URL is cleared and native UI status shows internet failure. Parent stdin EOF stops runtime/helper.

Record actual checks/evidence and any external service blockers in plan/done.
