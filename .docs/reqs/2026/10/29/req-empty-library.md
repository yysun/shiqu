# Empty library without bundled demos

Remove both bundled Dongguo and pear demos. A fresh library has no stories, with an actionable first-story discovery/shelf experience. Preserve existing user stories and their artwork; no generation, story deletion, database reset or remote push.

- [ ] Fresh/reopened SQLite and admin seeding insert no stories; retain the24 selectable full books.
- [ ] Reader home/shelf and unused admin component have no sample promotion, sample loading or demo fallback; creation remains accessible and saved recent stories still resume.
- [ ] Both demos' images, full story payload and demo-only provenance/excerpt files are absent from the shipped tree. Existing libraries retain all story/session/progress rows byte-for-byte and needed former bundled images in private local media, served safely at their original URLs.
- [ ] Local Git history/object storage contains neither demo artwork nor removed story payload blobs/paths; unrelated code/history/branches/current24-book originals and user changes are preserved. A complete recovery backup exists outside the repo before rewriting. No remote write.
- [ ] Applicable tests/typecheck/lint, fresh-library browser checks, existing-library media/row integrity and independent reviews pass. No desktop/Docker packaging.
