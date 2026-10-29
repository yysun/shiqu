# LAN-independent startup

Base: `bf7e160a58dbc45005d3d87d0ccdd0ac9f69be13`. Initial working tree clean. Non-low risk: protected lifecycle/authentication boundary; preserve the public pairing gate.

## Decision
Keep synchronous bounded tunnel startup for now. Catch errors only around the optional remote listener/helper startup; revoke remote access, stop any helper, close the remote listener, retain the local/LAN runtime, return running:true with safe internetError and no publicUrl. AbortSignal cancellation bypasses fallback and propagates to existing whole-runtime cleanup. Main listener/ownership failures remain fatal. The existing browser link condition stays running-only because the local runtime now survives optional tunnel errors; do not display a link to a stopped service. Make LAN “无需配对 ID” explicit in the card/README. Replace the README screenshot with an honest current desktop preview, without credentials or public QR secrets.

## Tasks
- [ ] Update optional startup handling in server/desktop.ts and regress missing-helper/early helper failure; preserve abort/stop/port-conflict cases.
- [ ] Update desktop/main.tsx LAN copy and README guidance/caption; capture a current screenshot via the existing in-app desktop preview.
- [ ] Run affected Node tests, typecheck/lint, then full applicable Node suite. Rust transport unchanged; reuse existing Rust evidence.
- [ ] Build/install/run Lite again per prior explicit request; packaged smoke check using disposable data. Verify installed UI has browser link after missing-helper startup without generating content or exposing personal data publicly.

## Review/evidence
AR passed: no blocking architecture flaws
AR risk: non-low — optional remote startup fallback with public authentication unchanged.
AR review round: 1; reviewer: reused (internet_review). No new tunnel feasibility probe needed: no vendor/protocol changes and prior live HTTPS evidence remains valid. Need independent AR/CR/VR per RPD. No other product changes.

Implementation evidence: optional remote startup now catches only its own failures; cancellation still escapes to whole-runtime cleanup. Missing-helper and early-exit cases assert running local/LAN access without Cookie or fragments and cleanup of the private entry; direct same-origin progress write and ownership release/restart covered. LAN UI/README explicitly say no pairing ID. Screenshot captured from existing in-app Vite preview (1280×1000 capture, viewport unchanged), reviewed visually, with no public credentials. README image replaced with JPEG to match browser output.
