# Extract stories from selected chapters

A chapter is a discovery scope, not a ready-made story. Readers must be able to choose several chapters from one book, let the LLM extract complete stories from that scope, then choose one for production.

- [ ] Select/deselect up to 24 chapters in one book; selections survive search filtering; native checkboxes in the list toggle selections, with a count and no selected stack. Book/mode changes clear them. Named Liaozhai stories and single Shishuo anecdotes retain their direct path.
- [ ] Starting chapter extraction saves a resumable discovery task with the canonical chapter scope. Count recommendation starts only after a returned story is chosen; storyboard and images require explicit final production confirmation.
- [ ] LLM input contains only selected chapters in original book order, including selected neighboring chapters for cross-chapter events. Every candidate is verified against that scope and original edition. Continue/retry/restart retain the scope; caches cannot mix scopes or whole-book discovery.
- [ ] Duplicate, stale, forged, cross-book, empty or excessive scopes fail before insertion; task replay is idempotent regardless of selection click order.
- [ ] Chapters containing isolated quality issues may be scanned for valid stories; each extracted candidate still passes the existing source-quality and token gates. No source text is altered or sent in contents metadata.
- [ ] Simplified/traditional full-text multiword search remains available, and existing saved direct tasks and theme discovery keep working. Controlled browser and automated checks do not call real paid providers or package applications.
