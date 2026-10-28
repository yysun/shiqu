# Local reader image batches

## Summary

The React reader requests three scenes at a time, with the last group clamped to the story length. The Node engine establishes the first image alone, then generates up to three missing images together using either Gemini or Codex. Immutable intermediate snapshots preserve completed images and usage while retaining the lock; failures settle all calls and retries retain completed work.

Implemented independently in `cce60cf`; main's implementation was not cherry-picked. Progress tracking also recognizes out-of-order completions.

## Verification

All 85 tests passed on Node 24.22.1 / pnpm 11.25.0, including 11 new tests using both actual provider adapters with controlled results, real SQLite, FileMedia, REST and the client loop. Typecheck, lint, production build, and whitespace checks passed. Independent CR passed with no major findings.

VR passed: all acceptance criteria complete.

## Notes

No database migration. Existing provider selection, authentication isolation, source preservation, ownership, deletion/restoration and single-scene requests remain covered by tests. No live paid generation or browser UI verification was performed. Provider calls already in flight can finish after leaving or deletion; completed results remain stored, while deleted stories remain hidden. Implementation is committed; final verification documents remain uncommitted under the RPD stop-before-GC workflow.
