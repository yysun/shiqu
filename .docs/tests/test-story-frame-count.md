# Story frame count E2E

Use actual provider adapters with controlled model responses, real temporary SQLite/FileMedia and REST. No live inference. Use the in-app browser against a separate temporary fixture app for visible controls; if disabled, explain the limitation and use a separate Playwright test session.

1. New selection without a count resolves to automatic. Invalid (0, 61, fractional, null, string number) values return 400. Legacy 8/10/12 stay accepted.
2. For Gemini and Codex, create auto sessions. Observe a 1–60 schema and automatic narrative instruction, a model-chosen 30-page plan, persisted automatic selection and actual 30 pages. Restart; resume the last batch without another planning call. Verify a short automatic output is permitted.
3. For each provider, request 1, 30 and 60. Observe exact output schema and persisted matching count; first image alone, later images at most three with first-image reference; final batch clamps to the actual story size. A mismatched plan fails before images.
4. On a 60-frame story, read media index 59, record a page event and saved progress 59, then restart and restore page 59. Index 60 and unavailable/out-of-story images fail; malformed media paths fail. Reading previous completed pages causes no inference.
5. In the available test browser, open story creation with a controlled candidate: automatic selected by default; manual begins at 36; slider/number synchronize at 1, 30 and 60; 1 shows 单幅; switching back to auto and manual remembers value. Inspect narrow viewport and focus/disabled semantics. Generate a single-frame story through the visible action, then reopen creation to confirm count editing applies only to new stories.

Record actual results in the plan/delivery note, distinguishing controlled inference from live model behavior.
