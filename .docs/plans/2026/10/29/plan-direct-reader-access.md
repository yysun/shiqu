# Direct reader access

Git base: `3be9e59095dbb489462332e624015d1d3ce837dc`.
Risk: non-low; intentionally removes reader authentication on reachable local/LAN listeners, as requested. Existing reader UI edits are unrelated and excluded.

Use the existing shared desktop access wrapper for Host/Origin validation and native-route denial, removing token/session exchange. Desktop advertises origins; native browser opening accepts only a loopback HTTP root URL. Development enables the same wrapper using its frontend port alone. Production start behavior remains unchanged. Remove obsolete pairing endpoints rather than adding a compatibility protocol.

- [x] Update shared access wrapper, desktop/development launch paths and native browser URL validation.
- [x] Update desktop wording, current documentation and smoke script to direct access.
- [x] Replace pairing expectations with direct-access, restart/persistence, Host/Origin and private-route regression assertions.
- [x] Run affected Node integration suites, typecheck, lint and native checks; verify desktop preview in the in-app browser. No packaging.

Validation: Node 24.22.1 / pnpm 11.25.0. Focus on desktop-lite, development-access, shared-library, desktop-library, desktop-node and local-server tests, Cargo checks and browser preview. A bounded temporary-data browser harness can verify direct HTTP access/restart without touching the personal library. No paid calls. Physical phone/firewall traversal and installed binary changes are outside source validation.

AR passed: no blocking architecture flaws.
AR risk: non-low — intentionally removes reader authentication from reachable local/LAN listeners.
AR review round: 1; reviewer: new. Independent reviewer: access_review.

Verification evidence:
- Node 24.22.1 / pnpm 11.25.0: six affected integration files, 22/22 passed (outside sandbox to allow temporary HTTP listeners). Explicit Host test uses node:http because Node fetch did not send the requested Host override.
- `pnpm typecheck`, `pnpm lint`, script syntax checks passed.
- `pnpm desktop:test:lite`: 13/13 passed with TAURI_CONFIG resource entries null for unavailable prepared runtime/node directories; no preparation/build/package commands run.
- Existing `pnpm desktop:preview` listener on 1420 reused in IAB; copy/QR help describes direct IP/port and no re-pairing.
- Temporary desktop listener, disposable library, existing reader static assets: IAB opened root directly, restart on same port retained page 3 (UI showed 4/10), then plain LAN origin opened successfully. Status URLs were plain origins. No paid calls or personal-library mutations.
- Initial sandbox listener failures and default Cargo resource-check failure were environmental and resolved with test-specific execution/configuration. Packaged smoke script updated/syntax checked; no packaged payload validation or physical phone scan claimed.
