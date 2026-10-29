# Empty first run without bundled demos

## Summary

Remove both Dongguo and pear bundles and their promotions. Fresh libraries start empty; creation stays available and24 source books remain. Existing saved stories keep their content, progress and privately preserved artwork through bounded legacy URL reads.

## Verification

306tests passed using Node24.22.1/pnpm11.25.0 with sequential30-second-bounded tests. Typecheck/lint, independent CR/VR and isolated in-app Reader/desktop Vite checks passed. History rewrite preserved110commits and117079historical file comparisons, removed44paths and52art/payload objects, and verified all1928source files. Final post-doc Git integrity/object checks passed; CHANGELOG was outside the original cleanup scope.

Final delivery rechecked the remaining admin-seed change: focused empty-library tests pass 2/2, including fresh/reopened/admin-seeded emptiness and preservation of existing stories/progress/media. Typecheck, lint and diff checks pass using Node 24.22.1 / pnpm 11.25.0.

## Recovery and scope

Private external backup: `/Users/esun/Documents/GitBackups/shiqu-empty-library-20261029-161506`. Contains original/pre-activation Git metadata, dirty-file copies, SQLite backups, commit mapping, scoped filter and final audit reports. Old demo objects remain only in private recovery backups and images needed by existing local stories. Do not publish these backups.

Implementation68b6a42 maps toe404837; fixture corrections5a98750 and verification5856594 follow. Formerbasee05c7a8 maps toda6851a. Concurrent background commit025da5c maps to453f923 and is outside this story. Local history only: no push/fetch or remote deletion. Updating GitHub requires separately authorized coordinated publication of rewritten history.

Preserved40desktop+10development legacy images; ordinary records3desktop/1dev, sessions21desktop/20dev retained. Normal concurrent last-read/page/image/usage changes were recorded and preserved; no task DB writes, story resets or generation calls occurred. Superseded Dongguo tracking and the pre-existing CHANGELOG are reconciled in a separate documentation commit. No packaging/build performed. Final delivery includes the server seed fix and these tracking records.

## Final acceptance review

VR passed: all acceptance criteria complete

VR risk: non-low — removes bundled content, preserves persisted media compatibility and rewrites local Git history.
VR review round: 1; reviewer: reused

1. **Complete — fresh libraries stay empty.** SQL initialization, admin seeding and reopen tests insert no stories. All 24 selectable books remain.
2. **Complete — sample promotion removed.** Reader home, shelf and admin source contain no demo loader or fallback. Creation remains accessible, and saved recent stories still resume. In-app checks confirm an empty Reader shelf, 24 books and a working creation action; desktop preview also shows zero stories.
3. **Complete — bundles removed; existing stories preserved.** Both artwork sets, full demo payloads and demo-only attachments are absent from shipped sources. Private preservation retains 40 desktop and 10 development images with matching hashes. GET/HEAD compatibility tests cover original URLs, missing files, invalid names and symlink rejection. Existing records, narrative/source and prior image URLs remain; documented concurrent reading/generation advances were preserved.
4. **Complete — local history cleaned safely.** External recovery backups and mapping evidence exist. Audit records 110 preserved commits, 117,079 historical file checks, 44 removed paths and 52 denied objects absent. Five branches and the rewritten tip tree were preserved; Git integrity and all 1,928 original-file hashes across 24 books passed. This task performed no remote write.
5. **Complete — verification and reviews passed.** Full suite passed 306/306; final typecheck/lint passed. CR passed with no major findings. ET preservation wording now matches the requirement and recorded live activity. All AP tasks are complete.

No AI generation or Docker/desktop packaging was performed. Unrelated background-generation changes and CHANGELOG remain outside this story.

Read-only acceptance review; no verification executed or files edited.
