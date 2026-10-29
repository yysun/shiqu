# Reader UI audit fixes

Readers need to choose a story, recognize its state, resume reading and recover a mistaken deletion without deciphering faint metadata or leaving the reader frontend. The audit found seven issues across Home, Bookshelf, Reader and Me.

## Acceptance criteria

- [x] Essential metadata across all four pages uses readable shared typography and foreground colors. Shelf metadata is at least 12px with measured text/background contrast of at least 4.5:1; reader metadata remains legible over the shaded scene.
- [x] Normal viewer narration gives more space to the artwork: 22px on desktop, 21px on phones with 1.65 line height. The optional larger-text setting remains available at 28px/26px.
- [x] Home exposes the current story's resume action and a prominent new-story action in the initial viewport at both the existing preview size and a representative 390×844 phone viewport.
- [x] Reader shelf deletion offers Undo; Me lists deleted stories with titles and restore controls, including after a reload. Restoration preserves original content, progress and favorites, and does not dispatch generation.
- [x] Bookshelf and Me describe library totals truthfully, including unfinished stories, rather than claiming every stored story has been read.
- [x] Favorite/delete tools retain matching colors and gain independent touch targets of at least 44×44px without overlapping reading controls.
- [x] Search and favorite filters explicitly show matched and total library counts and offer an obvious reset. Clearing filters restores the complete visible library.
- [x] The story ending contains working actions only; unavailable sharing controls are removed while export and navigation remain.
- [x] Compact cards retain the book-name/actions row beneath the image and the combined reading footer. Full-width cards retain the side-by-side cover/details structure and corner actions.
- [x] Automated verification and in-app browser verification cover all four screens and reversible delete/restore. No desktop preparation, bundle, Docker build, push or paid generation is requested.

## Boundaries

Use existing owner-scoped deletion/restore contracts and tombstones. No migration, permanent deletion, import-script changes, provider changes or queue redesign. Preserve the separate root README rewrite. The existing uncommitted compact-card changes belong to this delivery.
