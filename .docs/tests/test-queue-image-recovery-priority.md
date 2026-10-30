# Queue image recovery and reading priority flows

All flows use the controlled provider fixture with isolated SQLite and media through the REST API. No paid calls.

1. **Lost file at publication.** Page 0's generated file is removed before publication. The story fails with the redraw message and `retryMayCharge` true, with no further provider call. A retry redraws page 0 once and the story completes.
2. **Lost reference.** Page 0 is published, then its file is removed or corrupted. The next page fails with the same message and no provider call. A retry redraws page 0, then the remaining pages. Pages already saved are not redrawn.
3. **File comes back.** After the failure in flow 1 the file is restored. A retry publishes it with no provider call.
4. **Transient read.** Reading the file throws at publication. `retryMayCharge` is false, and a retry after the fault clears makes no provider call.
5. **Reading order.** With one worker and two stories, opening the newer story at page 3 draws its first image, then page 3 and the pages after it in order, with no other story's page between them, even though each page's publication briefly blocks the next. Moving to another page changes the next page drawn. Closing the story returns to page-number order.
6. **Passive viewing.** Observing failed, paused, stopped, completed and frame-count-waiting stories sends no demand and starts no provider call.
