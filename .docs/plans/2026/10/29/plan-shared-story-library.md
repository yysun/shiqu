# Shared story library

Base: f7229a3. Source work stays in the attached isolated worktree and is integrated into main without overwriting existing desktop/icon edits.

1. Add a development library resolver which honors explicit SHIQU_DATA_DIR, otherwise reads only dataDirectory from native desktop_settings (never desktop_credentials), otherwise uses the native app-data library default. Load .env before selecting the development directory; leave Docker/explicit production paths intact. User explicitly requires development phone/LAN testing. Keep Vite reachable on0.0.0.0 but protect its API and pairing routes with the existing pairing/cookie gate on the backend. Proxy /desktop/ alongside /api; print fresh public-port pairing links/QR codes. Static development assets/HMR remain available; private APIs require same-origin pairing for both localhost and phone. Vite fs.strict remains enabled; retain its environment/certificate/Git denies and add denies for .data, backups, all SQLite sidecars, media/cache folders and the selected library directory (literal escaped absolute glob). Test direct, ?raw and /@fs private-file requests as unauthenticated clients, including a library inside the workspace, while normal assets/HMR still load. The API backend remains loopback-only. Unit-test platform defaults, configured desktop paths, overrides and corrupt settings.
2. Add concurrent desktop/development integration coverage with separate SQLite connections and both authenticated/unwrapped entry points. Existing SQL-fenced jobs/session leases should exclude duplicate generation; test independent demand, visibility/progress/media and stopping one entry. If the probe finds a concurrency flaw, fix narrowly and re-review before enabling live sharing.
3. Inspect actual source/target row collisions and media. Stop the native supervised runtime through its controller (releasing the native directory lock), and stop the development server gracefully before offline consolidation, retaining already-started results. Back up both complete libraries and desktop runtime. Build a staged target from the desktop library, migrate that staged DB, merge source rows transactionally with exact duplicate checks and latest-timestamp progress reconciliation only; generated-session or paid-media conflicts stop replacement. The known published sample collision (zhongli, different reflection/revision) preserves both: keep the desktop row and import the development variant under a deterministic new published-story ID; rewrite its imported progress/event/job/deletion story_id references and record the mapping. Do not rename titles or change either story content. Copy/verify media hashes, quick_check, all original IDs and counts before atomic destination replacement. Never overwrite or remove source .data/dev; retain pre-merge desktop directory as backup.
4. Merge reviewed source into main, retain all unrelated files, rebuild the current reader and stage latest desktop Node runtime/client/migrations so the installed desktop supports immutable queue artifacts. Replace only the installed runtime while stopped, keeping native settings/UI and credentials. Set development SHIQU_DATA_DIR in its existing private .env to the shared absolute directory without echoing other values. The default resolver also prevents a new checkout silently creating a separate library.
5. Restart desktop and development against the shared Application Support path, preserving provider settings and localhost reader URL. Check actual open SQLite paths and identical story/session IDs, 东郭先生 media/plan/source/queue, pairing protections and no repeated paid outputs. Open the current reader through the in-app browser. Existing browser automation setting may require disclosed headless fallback only for test fixtures.
6. Run focused/full Node checks, lint/typecheck/build; no Rust source changes are planned. Review and record operational evidence, backups and limits.

Checklist:
- [x] Resolver/.env behavior and unit coverage.
- [x] Concurrent shared-library fixture and lifecycle regression coverage.
- [x] Backups, collision audit, offline staged merge and full preservation verification.
- [x] Reviewed source integrated, compatible installed runtime, both current entry points configured/restarted.
- [x] Full automated checks and live read-only shared-library verification.

E2E: .docs/tests/test-shared-story-library.md. Shared concurrent use requires the current fenced queue runtime on both servers; older installed desktop payloads must be upgraded before pointing at the merged store. No new credential reader beyond the single non-secret settings value. Rollback restores the archived target/runtime and the private env backup while writers are stopped; the source remains available throughout.

AR round2 passed with loopback design. User then explicitly required LAN phone testing; AR round3 reviews reusing the existing pairing gate for development APIs rather than disabling LAN. Resolver tests3/3 currently pass. No live data migration yet.

AR passed: no blocking architecture flaws.
AR risk: non-low — shared persistence, LAN authentication, frontend filesystem access and live consolidation.
AR review round:4; reviewer:reused.

SS concurrent probe passed: two independent SQLite connections share shelves/progress/media; paired desktop rejects unpaired requests, shared demand issues one anchor/image per page, one viewer leaving and development stopping do not halt desktop. Resolver3/3 and paired LAN Vite file-exposure test pass. Source migration remains pending.

SS source milestone: resolver, paired LAN development and Vite private-file restrictions implemented. Focused5/5 tests pass (real Vite, two SQLite connections); typecheck/lint/diff checks pass. One-time offline migration helper is at .data/evidence/shared-story-library/migrate.py, prepared for review before execution. Actual data/installed payload unchanged so far.

CR round1 blocked: Vite publicDir bypassed fs.deny, and final install lacked a reacquired native lock/manifest path binding. Fixed by rejecting public-nested libraries/private aliases/files before startup and testing real Vite; installing now binds CLI paths to the manifest and holds both old/new native directory locks during hash checks and swap. Development validates frontend before spawning shared-database child and cleans up failed startup. Focused6/6 pass. Verified stage/backups remain unchanged.
CR risk: non-low — private LAN exposure and live persistent-store replacement.
CR review round:1; reviewer:reused.


## Final verification and migration

CR fixed: Vite now rejects public-directory library overlap, private aliases and private public files before startup, including an initially absent public directory. Final migration installation binds paths to the verified manifest and holds both old and staged native directory locks through checks and replacement. Rerun result passed.
CR risk: non-low — LAN privacy, concurrent persistence and live store replacement.
CR review round:2; reviewer:reused.

TT passed: Node24.22.1 / pnpm11.25.0; full222/222 tests, no skipped/cancelled. Current typecheck, lint, build and diff whitespace checks passed. Focused6/6 includes real Vite HTTP/private-file/public-directory cases, resolver and two independent SQLite connections. No Rust source changes or Docker build.

Operational ET passed. Native GUI was stopped, both SQLite files had no open writers/WAL and native locks were available. First promotion refused a changed source snapshot without overwriting either store; the refreshed stage checks source DB/media at both ends of staging as well as immediately before installation. Failed-path and held-native-lock probes refused installation without changes.

Final backup: ~/Library/Application Support/com.shiqu.desktop/library-backups/20261029T133237Z. Archived original desktop: sibling library.before-shared-20261029T133237Z. The old development .data/dev remains intact. Verified354 source records,20 reader sessions (19visible+1deleted),292events,1progress,1tombstone,36production jobs and141 media hashes. Two published demo variants are preserved: desktopzhongli and mapped developmentzhongli-dev-d55e2f9be57d; imported references follow the mapping. Native configuration/credential DB unchanged during update; private.env backup mode0600 in backup directory. Both stores/runtime and rollback inputs retained.

Compatible installed runtime was staged from current main sources, preserving21 existing changed files byte-for-byte. Only installed Node runtime/client/migrations were replaced; native UI/settings unchanged. Local ad-hoc signature refreshed with identifier/entitlements preserved and codesign --verify --deep passed; native GUI reopened and successfully started service. Source milestonesfa5cc48 andaf740da are fast-forwarded into main.

Live development127.0.0.1:3001, desktop127.0.0.1:3000 and development LAN10.0.0.2:3001 return identical19 visible generated IDs and2 published variants. Both real Node processes open the same Application Support SQLite inode; neither opens old .data/dev. Unpaired APIs401, paired200; old development raw DB access denied. No HTTP generation requests were used for live verification. Latest saved东郭先生 retains30page script,10completed images and2610source characters, with exact script/source equality to backup and identical image SHA256 from all3 entry points.

Existing in-app browser tab was reused, paired and restored to东郭先生. Reading image/script visible and screenshot saved. Phone pairing URL/QR generated; LAN requests verified from this host, no claim of a physical-phone test. App stays available with development API private on127.0.0.1:3002 and Vite/desktop LAN interfaces enabled with pairing.

Local evidence: .data/evidence/shared-story-library/{tests.log,migrate.py,migration.json,live-verification.json,shared-reader.png,phone-pairing.png}. Runtime staging and private development log also exist under primary checkout .data/evidence/shared-story-library/. Pairing tokens and credentials are omitted from documentation.

VR passed: all acceptance criteria complete.
VR risk: non-low — shared persistence, authenticated LAN access, concurrent paid work and installed-runtime replacement.
VR review round:1; reviewer:reused.

## Delivery

DD finalized after the passing independent VR. GC includes only this story's completion report, REQ/AP/E2E evidence and the corrected shared-library instructions in README and desktop/README. Implementation milestones `fa5cc48` and `af740da` remain intact. The implementation is unchanged since passing CR/VR and the 222-test verification; documentation-only delivery requires no additional runtime test. Unrelated main-checkout changes remain outside the delivery commit.

User requested a fuller README before final main-checkout delivery. README now documents the Application Support database/media layout, explicit path precedence, separate credentials/pairing, concurrent desktop/development ports, phone QR selection and safe legacy migration/recovery. This is documentation-only; the reviewed implementation and its verification remain unchanged.
