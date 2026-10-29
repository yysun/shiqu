# Codex effort verification

No live generation. Temporary isolated settings only; never read or write production credentials in tests.

1. Environment runner: fake CLI simulates inherited high. With the env unset/blank no override is sent; explicit low/medium/high/xhigh/max produces the matching CLI config override and thread effort. Invalid light/uppercase/injection values fail before process spawn. Effective config or thread mismatch fails before turn/start.
2. Real installed CLI: explicit low status succeeds after config/read confirms low; no model inference is requested. This proves local CLI configuration feasibility, not output quality or every model's support.
3. Native storage: read SQLite settings and legacy settings.json omitting codexReasoningEffort, observe inherit; save low/high and reopen SQLite, observe exact persisted field. Reject illegal value without changing prior settings or credential. Run for Standard and Lite feature sets.
4. Desktop bridge: parse missing and explicit values, map to CODEX_REASONING_EFFORT, verify invalid values rejected. Existing pairing/lifecycle/secret isolation suites stay passing.
5. UI: load the actual desktop settings frontend using a controlled native IPC fixture in a test browser; select Codex, choose low, save, reload and see low; change high and verify save-before-start/connection-check; while running or pending, field disabled. Gemini hides the field without erasing its value. Inspect narrow layout at the supported native minimum width760. Prefer the in-app browser; if its known tool gate persists, disclose and use a separate Playwright test session.
