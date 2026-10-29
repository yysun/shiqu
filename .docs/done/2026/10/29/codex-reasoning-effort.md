# Codex reasoning effort

## Summary

`CODEX_REASONING_EFFORT` and the desktop Codex effort dropdown now support low/medium/high/xhigh/max, with blank preserving inherited defaults. Explicit choices are passed to the subprocess and verified against effective config and thread before inference. Native settings persist the choice in SQLite and read older settings without the field. Invalid settings cannot mutate credentials. Example configuration recommends Sol low; personal env/native settings remain untouched.

Implementation milestone: `44c798f`. Included related previously uncommitted Sol model documentation examples; unrelated icons/manifest/service-worker changes remain untouched.

## Verification

Independent AR/CR passed. Real installed CLI0.165.0 explicit-low status-only probe passed without inference. All validation used Node24.22.1 and pnpm11.25.0. Browser ET used a separate Playwright session on the actual desktop frontend with controlled native IPC; actual storage compatibility and reopen were tested separately through Rust/SQLite. At supported native minimum width760 the field is399px and page width remains760; screenshot inspected. The in-app tool still returns its unresolved disabled-in-Work message, which is not evidence of the user's chosen product or a manually disabled setting.

Final independent VR:

VR passed: all acceptance criteria complete
VR risk: non-low — native persistence and explicit CLI configuration span Rust, Node and desktop UI.
VR review round: 1; reviewer: reused.

1. Complete — `CODEX_REASONING_EFFORT` accepts the five explicit values; unset/blank inherits. Invalid values fail before subprocess creation. Node tests cover all values and invalid inputs.
2. Complete — Startup override, effective `config/read` and thread-effort verification enforce explicit settings before inference. Mismatch tests pass; real CLI status-only low probe confirms configuration propagation. Authentication and tool-isolation regression tests remain passing.
3. Complete — Desktop selection persists through native settings, maps to the runner environment, and shares the existing save-before-start/check flow. Browser ET verifies selection, save/reload, provider switching and pending/running locks.
4. Complete — Rust defaults missing fields in both legacy JSON and existing SQLite. Native reopen tests verify persistence and reject invalid settings before credential mutation.
5. Complete — Env and desktop documentation explain entry points, inheritance, model compatibility and restart requirements.

Recorded validation: Node 179/179, Standard native 14/14, Lite native 12/12; typecheck, lint, production and desktop UI builds, whitespace checks and scoped browser ET passed. All AP tasks are complete.

No blocking findings. Review reused supplied test evidence and inspected artifacts/code without edits or test execution. Existing installed desktop packages were not rebuilt; real generation quality and every model/effort combination were not tested.

## Notes

No global Codex configuration, secrets, story data, timeout or lease changes. No Docker or desktop installer build, no deployment or push. Updated installed desktop UI requires a new application build. Older app binaries may reject settings after the new field has been saved; back up settings before rollback. Existing cached results and saved stories are retained when effort changes.
