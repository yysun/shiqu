# Resume generation after reordering saved images

## Summary

Reordering the storyboard moved an image originally generated for page 2 into the first slot. Its immutable filename retained index `1`, while reference validation required index `0`. Generation therefore failed locally with `INVALID_ANCHOR` before contacting Codex.

Reference validation now accepts canonical image filenames with indices 0–59 inside the same story, including immutable artifact filenames. The caller still supplies the saved first image; media existence, content, and size checks remain in place. Resuming uses the existing images and generates the next missing page.

## Verification

Node 24.22.1 and pnpm 11.25.0:

- `pnpm exec node --test tests/reader-production.test.mjs tests/codex-provider.test.mjs tests/local-image-batches.test.mjs` — 60 passed.
- `pnpm run typecheck` — passed.
- `pnpm exec eslint lib/reader-image-assets.ts tests/reader-production.test.mjs` — passed.
- `git diff --check` — passed.

The new regression failed before the fix. Codex and Gemini regression scenarios now restart a 30-page story with 10 saved, reordered images, retry at page 11, and verify exactly one image call, no replanning, unchanged saved URLs and bytes, and one new image usage record. Invalid paths, other stories, unsupported formats, out-of-range indices, and missing references remain rejected before inference.

A read-only probe of the affected live story also accepted its saved reference and reached the page 11 generation call using a controlled provider. Hashes of all 10 saved images and the saved story record remained unchanged. The probe made no live inference calls or live library writes. Local evidence is retained under `.data/evidence/continue-generation-diagnosis/`.

CR passed: no major findings.
CR risk: low — localized validation fix with the same story, file type, and path restrictions preserved.
CR review round: 1; reviewer: not applicable.

Final VR:

VR passed: all acceptance criteria complete
VR risk: low — localized reference parsing change; no schema, queue, or persistence changes.
VR review round: 1; reviewer: not applicable.

1. Complete — Reordered saved images with nonzero filename indices are accepted as references within their own story. Boundary tests and the affected-story probe verify this behavior.
2. Complete — After restart and retry, generation begins at page 11 without regenerating or modifying the first 10 saved images. Controlled Codex and Gemini REST/SQLite/media regression scenarios verify the call, preserved bytes, and usage record.
3. Complete — Same-story path confinement, valid image formats and indices, media existence checks, and immutable attempt protection remain verified by the targeted suites.

## Notes

This is a source fix. Restart the local development server to load it. The installed desktop application still needs an updated build; no desktop or Docker packaging was performed. Real provider generation after the fix was not exercised. Unrelated reader UI edits are outside this delivery.
