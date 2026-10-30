# Image dimensions

## Summary

New generation consistently requests 2:3 portrait, targeting 1024 × 1536 where pixel sizing is supported and retaining Gemini's native 1K setting. Shared PNG/JPEG/WebP metadata checks enforce minimum displayed dimensions and ratio before storage, accounting for EXIF rotation. Invalid results preserve existing images; invalid admin IMAGE_SIZE settings fail before provider transport. No resizing, cropping, migration or new dependency.

## Verification

Pinned Node 24.22.1: final full suite 366/366 passed (27.531 s), typecheck, lint and diff checks passed. Controlled provider, HTTP/SQLite and queue tests cover format variants, native rounding, invalid output preservation, overrides, downloads and explicit retries. Earlier fixture failures were corrected to use distinct valid images; an unrelated Vite cleanup flake passed in isolation and in the final full run. No live generation or builds.

## Notes

Implementation milestones: `44cad54` and `2b65d29`. Existing images, references and manual uploads retain prior behavior. Metadata checks do not decode pixels. Concurrent reader UI edits remain outside this story. DD/GC finalizes this story's tracking documents together with the previously verified storyboard-review delivery records; it does not include the concurrent UI edits or push commits.

## Final VR

VR passed: all acceptance criteria complete

VR risk: non-low — coordinated generated-media acceptance across provider, HTTP and storage boundaries.
VR review round: 1; reviewer: reused

1. **Complete — consistent requests.** Shared reader instructions specify 2:3 portrait and a 1024 × 1536 target where supported. Admin requests use 2:3 and explicit pixel dimensions. Gemini retains 2:3 / 1K settings. Provider and admin request assertions passed.

2. **Complete — returned dimensions validated.** Shared metadata inspection supports PNG, baseline/progressive JPEG and VP8/VP8L/VP8X WebP, including EXIF display rotation. Tests verify Codex/admin minimums, native Gemini minimums, and the 1% relative ratio tolerance.

3. **Complete — invalid results preserve assets.** Unreadable/truncated metadata, wrong orientation, square/landscape images and undersized results fail before storage. Provider and admin tests verify unchanged prior assets; admin tests additionally preserve story revision. Safe errors explain the size requirement.

4. **Complete — admin overrides enforced.** Overrides require exact 2:3 dimensions of at least 1024 × 1536. Invalid configuration makes zero transport calls. Larger valid overrides are sent to the provider and enforced as the returned-image minimum.

5. **Complete — existing contracts preserved.** Existing images and references remain readable; manual uploads retain their previous behavior. Reader format and 12 MiB checks remain. Queue tests verify passive demand does not repeat failed generation and explicit retry succeeds. Corrected concurrency fixtures retain and strengthen attempt-fencing assertions.

All AP tasks are complete, and the documented HTTP/provider/queue scenarios passed. The final full suite passed **366/366** in **27.531 seconds**, with no skipped or cancelled tests; final typecheck, lint and diff checks passed. AR and both CR rounds passed.

Evidence is limited to controlled responses and actual local persistence/HTTP execution. No paid calls, image generation, builds or browser visual verification occurred. Metadata validation does not establish complete pixel decodability or artistic quality.
