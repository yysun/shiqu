# Replace publication book sources

Base: fa14a6c7fc8183a2d33502051c4851771d26a729
Risk: non-low — bundled editions, citation identities and integration behavior change across components.

Use Wikisource for the twelve listed novel/story collections, and Kanripo for 庄子、列子、搜神记、博物志、战国策. Preserve upstream original bytes and attribution. Prefer a complete named edition; do not combine unacknowledged editions or guess missing glyphs. Preserve seven retained originals and all user data. Keep stable book IDs; changed edition hashes invalidate newly submitted old receipts, while stored original text remains reopenable.

- [x] First SS feasibility probe: retrieve representative Wiki index/chapter and Kanripo edition metadata/text, verify identity and reuse statement, and establish complete chapter manifests. If candidates are incomplete, revise sourcing before dependent runtime work.
- [x] Download replacements respectfully with serialized requests, caching and backoff; validate every chapter/body/identity. Record source metadata, ordered hashes, scope and anomalies. Remove superseded originals after replacement validation.
- [x] Extend deterministic offline parsing for new editions using existing HTML/text primitives; enforce exact file manifests, identity, sequence and fail-closed integrity. Preserve retained parsers and citation contracts.
- [x] Replace the demo passage and provider attribution in lib/content.ts, lib/reader-source.ts and docker/seed.sql without rewriting saved data.
- [x] Update meaningful whole-library, edition-specific, corruption, source-quality and HTTP integration coverage for actual new sources; preserve retained-source assertions and add saved-story/stale-receipt regressions.
- [x] Update data/library/source-notices.md, data/README.md and README edition details with CC BY-SA 4.0 attribution/changes and licensing boundaries. Keep counts at 24 only if evidence supports it.
- [ ] Run pnpm test, pnpm typecheck and pnpm lint under Node 24.22.1 / pnpm 11.25.0; execute matching HTTP/offline E2E scenarios through integration tests. Inspect tree, hashes and packaging boundaries.

No builds/push/history rewrite. CUA browser disabled by host settings; use real HTTP integration and source-level selector checks. Milestone commits include only intended changes. Untracked CHANGELOG.md is unrelated and stays untouched. Record actual milestones and verification below.

## AR / feasibility
AR passed: no blocking architecture flaws. AR risk: non-low. AR review round: 1; reviewer: new (source_review). Probe confirmed Wiki indices and parseable 聊齋 first volume, Kanripo33 莊子 /8 列子 /20 搜神記 /10 博物志. 戰國策 master groups material in10 physical files, so choose the named tls edition (501 chapter files with independent headings and source metadata), recording this changed section granularity explicitly. Source originals and all comment metadata remain archived; runtime removes layout/metadata only. No semantic model repair.

Completeness comparison found the old 西游第8回 contains 陈光蕊附录, while Wikisource lists that narrative separately. Preserve it as an additional section after第8回 (100回+附录,101sections). Also preserve 纪汝佶六则 as the explicit Wiki附 page after 阅微24卷 (25sections), matching existing narrative scope. Exclude non-narrative frontmatter and the already excluded 浮生伪续. Amend deterministic page maps, manifests and assertions accordingly; no cross-source content mixing.

AR affected review round3 (source_review reused): AR passed: no blocking architecture flaws. 西游 appendix uses xiyou-000 afterxiyou-008; chapters9–100 retain numbered section IDs. 阅微 appendix remainsyuewei-025.

Milestone b2becd0: deterministic licensed collection loader plus independently sourced sample and CC license. Focused evidence: five Kanripo collections loaded/cited offline, every body glyph compared in the dedicated source test (temporary staged-data root); 579 upstream Git blobs matched byte-for-byte; reader-source suite11/11; fresh SQLite seed matched application excerpt exactly; typecheck/lint passed before ongoing unrelated discovery edits. Full source replacement and TT/ET/CR/VR still pending; no release/push. Concurrent user commits c6cd8af, bc76f67, 6a3496e and unrelated fast-first-story working files are outside this story's diff despite sharing its base ancestry.

Source-quality finding: Wiki酉阳全30卷 parse,131747bodychars,160PUA+6squares. Same pre-existing policy keeps original glyphs and rejects affected original blocks; every volume retains readable passages (952 individual valid receipts;306 rejected including headings/short units). Record exact anomalies and assert rejection rather than retaining the former Shidian-specific zero-PUA assertion. KanripoKR3l0125 WYG sample nearly empty and SBCK lacks continuation, so neither candidate used. Requirement is disclosed defects and fail-closed selection, not an unsupported zero-error claim.

Final acquisition:628 Wiki chapter bodies+12indices and579 Kanripo files staged from independent upstreams; all17 editions installed and old120 source files removed. Seven retained original collection hashes unchanged. Every new Wiki body parsed and retained CC BY-SA4.0 footer; no unexplained >25% / >1000-character chapter truncations relative to former scope after appendix reconciliation. Focused six-file suite35passed/1fixture failure; failure was pre-existing mock returning2stories despite concurrent one-story scan limit, corrected to exercise good and rejected bad candidates in separate requests without relaxing source qualification. Dedicated affected suite passed. Full TT/ET and CR/VR remain pending.
