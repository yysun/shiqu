# Viewer metadata toggle

## Summary

Tapping the middle half of a story page now toggles the title, metadata, page-number line and controls. Narrative text stays visible in its original position, with the artwork shade retained for readability. The outer quarters still turn pages. The metadata choice survives page turns and resets when opening another story; the ending screen keeps its controls visible.

Removed the navigation instruction line shown below the narration. Active generation now appears beside the page count, with a spinner and the current stage.

## Verification

- Node 24.22.1 and pnpm 11.25.0: `pnpm run typecheck` and targeted ESLint passed.
- `tests/reader-interaction.test.mjs`: 11/11 passed.
- An isolated handler check during implementation passed repeated center toggles, left/right edge turns, horizontal/vertical swipes, short drags, long presses, return drags, pointer cancellation and keyboard activation. This exercised component handlers with isolated React refs; it was not a browser test.
- Reader CSS parsing and scoped `git diff --check` passed.
- Narrative-visibility correction: scoped the hidden selector to the page-number line instead of the caption container and kept the artwork shade visible. CSS parsing and targeted ESLint passed; navigation handlers were unchanged.
- CR passed: no major findings.
- CR risk: low — localized, reversible viewer changes.
- CR review round: 1; reviewer: not applicable.

## Notes

- Formal VR was not run for this low-risk change. In-app browser verification remains pending because local browser access was disabled in Work settings; no visual or packaged-app verification is claimed.
- No desktop preparation, packaging or Docker build was performed. The installed desktop app must be rebuilt and replaced to receive these source changes.
- Delivery includes only the three viewer files and this note. Separate image-asset and production-test edits remain outside this change.
