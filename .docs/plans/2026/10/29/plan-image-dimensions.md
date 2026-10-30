# Image dimensions

Risk: non-low — coordinated provider and admin acceptance changes at external generation/storage boundaries. No dependency or schema changes.

Base: 4b42cec0ee0f93331ef2093525d08396e3444741. Previous storyboard review tracking documents are outside this story.

Decisions: shared bounded PNG/JPEG/WebP metadata parser; no pixel decoder or image transformation. Reject malformed/unreadable dimension metadata. Validate 2:3 within 1% relative deviation for provider rounding, with explicit provider minimums. Codex/admin target/minimum 1024 × 1536; Gemini retains 1K and minimum 832 × 1248 (documented native output includes 848 × 1264). Admin override must be exact 2:3, integer dimensions and at least default; output must meet override minimum. Return a specific safe dimension error through existing failure paths, without changing automatic retry policy or existing references/uploads.

Source: https://ai.google.dev/gemini-api/docs/image-generation (2:3 / 1K native dimensions differ from exact pixel target).

- [x] First SS probe: exercise the shared parser against actual PNG/JPEG/WebP fixtures, including Gemini 848 × 1264. If parsing cannot handle provider format variants, stop dependent integration and revisit plan.
- [x] Add shared dimensions/size policy and integrate reader prompt, both providers and admin generation; preserve MIME/12 MiB/reference behavior and correct admin image extension from actual MIME.
- [x] Replace signature-only success fixtures with real portrait images. Add format/ratio/minimum/truncation tests, provider save/no-save tests, admin configuration/request/save/no-save HTTP tests and queued failure/retry regression.
- [ ] Run focused checks then full pnpm test, typecheck and lint. Execute matching boundary scenarios from test-image-dimensions.md with controlled transports.

Rollback: revert this story's source changes; existing stored images remain readable without migration. Metadata validation cannot prove complete image decodability or artistic quality.

AR passed: no blocking architecture flaws

AR risk: non-low — coordinated changes to provider responses and admin configuration at generation/storage boundaries.
AR review round: 1; reviewer: new

Read-only independent review accepted bounded parsing without a dependency. Account for EXIF displayed orientation or reject unreadable orientation metadata; cover this as part of dimension validation.

SS probe passed: actual PNG, baseline JPEG, lossless/lossy WebP, 848 × 1264 and 832 × 1248 native dimensions; EXIF rotation is reflected for PNG/JPEG/WebP. Additional tests cover progressive JPEG and extended alpha WebP. No new runtime dependencies.

Focused regression: 33/33 passed (`tests/image-dimensions.test.mjs` plus `tests/local-image-batches.test.mjs`, 3.444 s). Initial adapter regression passed 57/59; two new assertions incorrectly queried a nonexistent queue output field, corrected to the persisted `result` column and verified by the passing focused suite. Typecheck and lint passed. Full suites and final reviews pending.

Concurrent edits to `client/ui/Reader.tsx`, `client/ui/StoryReadingState.tsx` and `client/ui/reader.css` are outside this story; preserve them and exclude them from the story commit/review.
