# LAN-independent startup

Base: `bf7e160a58dbc45005d3d87d0ccdd0ac9f69be13`. Initial working tree clean. Non-low risk: protected lifecycle/authentication boundary; preserve the public pairing gate.

## Decision
Keep synchronous bounded tunnel startup for now. Catch errors only around the optional remote listener/helper startup; revoke remote access, stop any helper, close the remote listener, retain the local/LAN runtime, return running:true with safe internetError and no publicUrl. AbortSignal cancellation bypasses fallback and propagates to existing whole-runtime cleanup. Main listener/ownership failures remain fatal. The existing browser link condition stays running-only because the local runtime now survives optional tunnel errors; do not display a link to a stopped service. Make LAN “无需配对 ID” explicit in the card/README. Replace the README screenshot with an honest current desktop preview, without credentials or public QR secrets.

## Tasks
- [x] Update optional startup handling in server/desktop.ts and regress missing-helper/early helper failure; preserve abort/stop/port-conflict cases.
- [x] Update desktop/main.tsx LAN copy and README guidance/caption; capture a current screenshot via the existing in-app desktop preview.
- [x] Run affected Node tests, typecheck/lint, then full applicable Node suite. Rust transport unchanged; reuse existing Rust evidence.
- [x] Build/install/run Lite again per prior explicit request; packaged smoke check using disposable data. Verify installed UI has browser link after missing-helper startup without generating content or exposing personal data publicly.

## Review/evidence
AR passed: no blocking architecture flaws
AR risk: non-low — optional remote startup fallback with public authentication unchanged.
AR review round: 1; reviewer: reused (internet_review). No new tunnel feasibility probe needed: no vendor/protocol changes and prior live HTTPS evidence remains valid. Need independent AR/CR/VR per RPD. No other product changes.

Implementation evidence: optional remote startup now catches only its own failures; cancellation still escapes to whole-runtime cleanup. Missing-helper and early-exit cases assert running local/LAN access without Cookie or fragments and cleanup of the private entry; direct same-origin progress write and ownership release/restart covered. LAN UI/README explicitly say no pairing ID. Screenshot captured from existing in-app Vite preview (1280×1000 capture, viewport unchanged), reviewed visually, with no public credentials. README image replaced with JPEG to match browser output.

CR passed: no major findings
CR risk: non-low — optional remote startup cleanup and preserved local/LAN availability.
CR review round: 1; reviewer: reused.

TT found two verification fixture issues under a concurrent full run: the 300ms helper deadline could kill the fake helper before its PID file existed; changed to a 5-second bounded timeout and observe helper readiness before awaiting the expected timeout. The existing development LAN test hung during backend teardown because Vite proxy keep-alive sockets were closed by a later hook; explicitly close backend connections during its teardown, after assertions. No application behavior is changed by these test fixes. Full run stopped to rerun affected cases before the full suite.

CR passed: no major findings
CR risk: non-low — prior lifecycle/authentication review remains valid; second round changes only test timing/teardown.
CR review round: 2; reviewer: reused.

TT final: full pnpm test passed 249/249 in 23.17s after fixture repair; affected Node tests initially18/18, repaired timeout/development fixtures13/13; pnpm typecheck and pnpm lint passed. Rust source unchanged, reuse previous native transport/migration evidence.

Packaged evidence: pnpm run desktop:build:lite --bundles app built macOS arm64 Lite0.1.0 (149.89 MiB), no bundled Node. Packaged smoke passed (24 books, direct/LAN access, persistence, shutdown, paidCalls0) with disposable data. Installed to ~/Applications/Shiqu Lite.app with prior app backed up under /private/tmp/shiqu-lite-previous-mavn6w9v; installed executable SHA-256 fd21344fd459c0f872c316f50797910e5d3328477318919a12268ee546baa8c4.

ET installed app: preserved internetEnabled=true and missing-helper setup. Port3000 was legitimately occupied, so changed only Lite's port to free3005 through native settings, leaving the existing service running. Native UI now shows service running, “在浏览器打开” at http://127.0.0.1:3005/, direct LAN QR http://10.0.0.2:3005, “无需配对 ID”, and internet-only missing-cloudflared warning. Native opener clicked successfully: Chrome tab844496437 opened local3005; normal app uses system default browser. IAB separately opened localhost3005 and LAN10.0.0.2:3005 and rendered the reader home directly, no /connect, fragment or pairing prompt. No story/generation action invoked; existing reader service left running. Native UI was returned to user control when their interaction changed the app; no further UI mutations attempted.

ET screenshot: README references .docs/assets/desktop-app.jpg, browser-captured1280×1000 current desktop preview, verified visually and matching internet-only toggle plus always-on LAN/no-pair wording. Caption explicitly identifies development preview. No public pairing credentials captured or app settings changed for the screenshot.

SS milestone: ed27f04 (LAN fallback, regression coverage, README screenshot and guidance).

Final independent validation: VR passed: all acceptance criteria complete. VR risk: non-low — optional remote startup cleanup with local/LAN availability preserved. VR review round:1; reviewer:reused. Full criterion result is preserved verbatim in the done report. No required work remains for this correction story. Earlier public-tunnel implementation story retains its separate historical evidence limits; this correction verifies LAN fallback and screenshot/browser-link behavior.
