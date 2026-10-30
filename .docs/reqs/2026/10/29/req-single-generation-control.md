# One control for story generation

Readers should decide whether a story is generating with Pause / Resume. A second background-mode switch creates a redundant decision and hides why generation stops on leaving.

- [ ] Shelf cards and reading preferences contain no background-generation switch or enable confirmation; the secondary Pause / Resume action stays beside progress.
- [ ] New stories default to whole-story generation without a reader window; confirmed frame counts remain required before planning/drawing.
- [ ] Pause persists across windows/restarts, blocks new work and saves in-flight results. Resume continues missing work through the whole story without a mode choice.
- [ ] Upgrade preserves all checkpoints and existing manual controls/background intent. Old reader-mode stories become background/paused so upgrade cannot unexpectedly dispatch paid work.
- [ ] Failures retain explicit retry, deletion/restore remains disarmed, and owner/origin/lease/concurrency protections remain intact.
- [ ] Controlled integration tests, applicable local suites, typecheck/lint, and in-app UI verification evidence the final behavior without paid requests or personal-library writes.

Scope: reuse the durable background queue; retain legacy mode/action API compatibility. No scheduler rewrite, dependency changes, Docker build, or desktop packaging.
