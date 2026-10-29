# Direct reader access

Desktop and local development readers open at `http://IP:port`; QR/copy links no longer carry secrets and service restarts no longer revoke reader access. Host/Origin validation, LAN opt-in, private-file restrictions and native settings isolation remain. All reachable devices share the library and generation permissions.

Verified with Node 24.22.1 / pnpm 11.25.0: 22 affected integration tests, typecheck, lint, script syntax and 13 Lite native tests passed. In-app desktop preview and a disposable desktop HTTP library verified direct root/LAN access, same-port restart and saved progress. Milestone: `65c148c`.

Standard native suite compiled, with 14/15 passing; the remaining existing bundle-integrity test needs the absent prepared Node manifest/binary. No preparation, Docker build or desktop packaging was run. Installed apps require rebuilding; physical phone scanning and packaged smoke remain unverified. Unrelated concurrent reader changes were preserved.

VR passed: all acceptance criteria complete.
VR risk: non-low — direct LAN access grants reachable devices the shared reader and generation permissions.
VR review round: 1; reviewer: reused.

| Acceptance criterion | Result | Evidence |
|---|---|---|
| Desktop links and QR use plain origins | complete | Desktop status supplies `local` and `phones` directly; QR/copy consume those values; native opener accepts only a loopback HTTP root URL. |
| Development links and API need no pairing | complete | Token generation/configuration removed; terminal QR uses plain phone origins; real Vite proxy integration verifies cookie-free reads/writes. |
| Reader/media/progress survive restart without cookies | complete | Desktop lifecycle and shared-library regressions; recorded IAB root/LAN navigation and same-address restart retained page 3. |
| Preserve remaining access boundaries | complete | Host/Origin checks and desktop LAN opt-in retained; native routes denied; private/raw/@fs restrictions covered by integration tests; native settings remain outside HTTP. |
| UI, docs and verification describe direct access | complete | Desktop wording, both READMEs, desktop E2E and smoke script updated; LAN permissions are explicitly disclosed. |

Existing evidence: 22/22 affected Node integration tests, typecheck/lint/script syntax checks and 13/13 native Lite tests passed. IAB preview and temporary-data direct navigation were verified. Packaged payload validation and physical phone scanning were not performed; no paid calls occurred. No files changed or tests rerun during this review.
