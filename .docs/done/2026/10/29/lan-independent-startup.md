# LAN-independent startup

## Summary

Missing or failed cloudflared no longer stops the desktop reader. Only the optional public entry is revoked and cleaned; LAN, localhost, data ownership and the browser link remain available. LAN URLs contain no pairing ID and require no cookie. Startup cancellation, port conflicts and ownership failures retain full cleanup behavior. README wording and desktop preview screenshot now show the separate internet toggle and no-pairing LAN access.

## Verification

Independent AR and CR round2 passed. Full Node suite249/249, affected regressions and type/lint checks passed. Full-suite test fixtures now observe helper startup before timeout assertions and close Vite proxy backend connections during teardown; no assertions weakened. Packaged Lite macOS arm64 smoke verifies direct/LAN access, persistence and shutdown with disposable data and zero paid calls. Rebuilt/installed Lite0.1.0, no bundled Node; installed app has verified artifact hash below.

Installed UI with internet enabled/missing helper retains the service, shows an internet-only warning, browser link and direct LAN QR. Native browser action opened localhost in system Chrome; separate in-app local/LAN readers rendered without a pairing page. README screenshot is an honest development preview captured in-app and visually reviewed. No public pairing secrets captured.

## Notes

Lite uses free port3005 because configured port3000 was occupied; the other service remains running. Only the port was changed; provider and library configuration preserved. Internet remains optional and requires separately installed cloudflared. No public tunnel or generation action invoked. User resumed interaction with the native app after verification, so further UI mutations stopped. Source milestone: ed27f04.

## Final VR result

VR passed: all acceptance criteria complete

VR risk: non-low — optional remote startup cleanup with local/LAN availability preserved.
VR review round: 1; reviewer: reused

1. **Complete — Local/LAN survives internet failure.** Missing-helper and early-exit fixtures return `running:true`, a normal localhost URL, direct LAN links, an empty public URL and a safe internet-only error. LAN requests require neither fragments nor cookies. Installed Lite confirms the same behavior.

2. **Complete — Cleanup and fatal failures remain correct.** Tests verify failed remote listeners/helpers/configuration are removed, explicit stop releases the local port and ownership, and restart succeeds. Startup EOF/abort still shuts down the complete runtime. Port conflicts and ownership failures remain fatal; public authentication is unchanged.

3. **Complete — Browser link, wording and screenshot.** Installed Lite displays “在浏览器打开”, the local address, a direct LAN QR and explicit “无需配对 ID” guidance despite missing `cloudflared`. The native opener launched the local reader in the system browser. In-app browser checks rendered both localhost and LAN readers without pairing. README distinguishes access modes and includes the visually reviewed current development-preview screenshot.

4. **Complete — Verification and installed artifact.** Full Node suite passed 249/249; focused regressions, typecheck and lint passed. Rebuilt Lite passed packaged smoke checks for 24 books, direct/LAN access, persistence and shutdown with `paidCalls:0`; installed executable SHA-256 is `fd21344fd459c0f872c316f50797910e5d3328477318919a12268ee546baa8c4`. No new helper installation, public tunnel, Docker build or generation action occurred. Port changed from occupied 3000 to free 3005; unrelated service and provider configuration were preserved.
