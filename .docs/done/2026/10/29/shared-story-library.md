# Shared story library

## Result

Desktop and development now use `~/Library/Application Support/com.shiqu.desktop/library`, including its SQLite database and `media/` directory. Development honors `.env`/explicit `SHIQU_DATA_DIR`, otherwise follows desktop's configured library. It remains available for phone testing with paired APIs and printed pairing links/QR codes. Private Vite file paths and unsafe public-directory library configurations are blocked.

The offline merge preserved all 20 saved sessions (19 visible, one soft-deleted), 141 media files, 292 events, 36 queue jobs and reading progress. The latest saved 东郭先生 has 30 pages and 10 completed images; its source, script and saved images match the original backup exactly. Both differing demo versions were retained, with the imported development version mapped to `zhongli-dev-d55e2f9be57d` and its references updated.

Both real Node processes opened the same physical database. Paired desktop 3000, development 3001 and development LAN 10.0.0.2:3001 returned identical shelves and image hashes. The existing in-app reader was paired and restored. LAN requests were tested from this computer; no physical-phone test is claimed.

## Preservation and recovery

- Complete backup: `~/Library/Application Support/com.shiqu.desktop/library-backups/20261029T133237Z`.
- Archived original desktop library: sibling `library.before-shared-20261029T133237Z`.
- Old development `.data/dev` retained, unchanged by consolidation. A first stale-snapshot installation was safely rejected; the refreshed snapshot was verified before replacement.
- Installed desktop Node runtime/client/migrations upgraded with backups; native settings/credentials retained. Local ad-hoc signature refreshed preserving identifier/entitlements and verified. The native controller successfully restarted.
- All 21 unrelated changed main-checkout files were verified byte-for-byte intact. Source commits `fa5cc48` and `af740da` are integrated into main. No Docker build or push.

Rollback requires stopping both entry points, restoring the archived library/runtime and private development.env backup, then restarting. Do not restore over live writers. Older desktop payloads cannot serve current queue artifact URLs.

## Verification

Node 24.22.1 / pnpm 11.25.0. Full suite: 222/222 tests; focused checks: 6/6; typecheck, lint, build and whitespace checks passed. Fixture tests cover separate SQLite connections, duplicate paid work, independent demand/shutdown, cross-entry progress/media, real Vite pairing and direct/raw/@fs/public-directory protections. Live verification used GET/pairing requests and requested no generation. Phone pairing QR and in-app screenshot are in `.data/evidence/shared-story-library/`; pairing tokens are intentionally omitted here. The full migration manifest/helper and test/live-verification logs remain there.

## Final acceptance review

VR passed: all acceptance criteria complete.

| Criterion | Status | Evidence |
|---|---|---|
| Shared default directory with explicit overrides and credential separation | Complete | Resolver and environment precedence tests pass. Development follows native `dataDirectory`; its code never queries desktop credentials. Both current entry points use the Application Support library. |
| Backed-up, lossless consolidation including 东郭先生 | Complete | Final manifest records 354 verified source rows, 20 sessions, 141 media hashes and 36 production jobs. Both published sample versions survive with recorded reference mapping. Original development store, backups and archived desktop store remain. I independently confirmed all 20 original session IDs, all 141 media hashes, exact 东郭先生 plan/source/images and SQLite integrity. |
| Compatible concurrent entry points with protected LAN access | Complete | Separate-connection tests prove shared progress/media, duplicate-call exclusion and independent demand/shutdown. Both real Node processes currently open the same database path. Live evidence records identical shelves through desktop, local development and LAN development, with unpaired 401, paired 200 and private-file access denied. Installed runtime was upgraded; native settings remained unchanged. |
| Automated and live verification, preservation and documentation | Complete | Full suite 222/222 with no skipped/cancelled tests; current typecheck, lint, build and diff checks passed. All four E2E flows are evidenced. In-app browser screenshot visibly restores 东郭先生. Unrelated working files were preserved; path, overrides, migration, restart and rollback behavior are documented. |

The migration helper’s added beginning/end snapshot checks strengthen the reviewed preservation design; final installation retained manifest binding and both native locks. The first changed-source promotion was correctly rejected before the refreshed stage was installed.

Verification used controlled generation fixtures and read-only live requests. LAN access was tested from the host; no physical-phone test is claimed.

VR risk: non-low — shared persistence, authenticated LAN access, concurrent paid work and installed-runtime replacement.
VR review round: 1; reviewer: reused.

All AP tasks are complete. CR round 2 remains valid for the unchanged source. No tests rerun or files changed during this review.
