# Codex reasoning effort

Story base: `6358e0e0186030459b2e9452b47ab28e67eab31e`.

## Decisions

Add a shared TypeScript list/schema of the five supported explicit settings plus empty (inherit), consumed by the desktop UI, Node settings schema and Codex runner. Native Rust settings use the same allowed values and `serde(default)` for the new string `codex_reasoning_effort` (`codexReasoningEffort` over JSON). Both fresh and existing desktop settings default to inherit; no SQLite schema migration or credential changes.

Pass a nonempty env value through app-server's `-c model_reasoning_effort=...` override, validate effective `config/read` and `thread/start.reasoningEffort` before inference. Omit the override and checks for inherited defaults. Invalid or ignored explicit settings fail closed with safe configuration errors. Existing authenticated status remains inference-free. Image and text requests share the existing runner configuration; no new per-stage settings.

The current README and .env.example already have uncommitted Sol model example edits; those directly related lines are included in story scope and retained. Other icon/manifest/service-worker changes are unrelated and preserved. `.env` and saved personal desktop settings will not be mutated by this implementation; the new field is configurable through the normal entry points.

## Tasks

- [x] Add shared effort values/schema and runner configuration/validation in `lib/codex-settings.ts` and `server/codex-runner.ts`; add safe setting errors to `server/generation.ts`.
- [x] Connect `codexReasoningEffort` through desktop TypeScript settings, native Rust defaults/validation/persistence and desktop dropdown (`server/desktop.ts`, `src-tauri/src/config.rs`, `desktop/main.tsx`).
- [x] Extend fake CLI protocol, Node integration tests and Rust settings tests for explicit/inherited/mismatched/invalid values, actual desktop variable mapping, SQLite reopen and legacy field omission; preserve auth/tool restrictions.
- [x] Document the setting in `.env.example`, `README.md`, `desktop/README.md`.
- [x] Run full Node test suite, typecheck, lint, production build, desktop UI build and both native feature test suites, Node24.22.1 / pnpm11.25.0. No Docker or installer build.
- [x] Execute `.docs/tests/test-codex-reasoning-effort.md` using controlled desktop UI and real native configuration tests; perform a bounded real CLI status-only probe for low without inference.

## Risks / review

Non-low risk: native persisted settings and external subprocess configuration cross the desktop/Node boundary. Independent AR, CR and VR required. Native JSON grows by one optional-on-read field; older binary versions reject saved settings containing the new field, so rollback requires a settings backup or removing the field using compatible tooling. Existing credentials remain intact. Supported model/CLI combinations may reject an offered effort; fail visibly instead of silently switching.

First SS feasibility probe: call the existing installed CLI status-only with explicit low after runner changes; effective config must report low without any turn/start. If unsupported, stop dependent implementation and return to AR with a viable propagation approach.

## Evidence

AR passed: no blocking architecture flaws

AR risk: non-low — persisted native settings and CLI configuration cross Rust/Node/UI boundaries.

AR review round: 1; reviewer: new.


SS feasibility probe passed: installed CLI0.165.0, Node24.22.1, explicit low status-only returned configured=true/model=gpt-6.1-sol after effective config check. No turn/start or inference requested.

Focused Node verification: 19/19 provider/desktop tests passed, including all explicit values, inheritance, config/thread mismatches and desktop variable mapping. Desktop frontend production build passed.


SS milestone: `44c798f`, including the related preexisting Sol model examples. Focused Node19 tests, native persistence test, typecheck and desktop frontend build passed before CR (one test-only unused-mut warning subsequently removed).

CR passed: no major findings

CR risk: non-low — subprocess effort and persisted desktop settings cross CLI/Rust/Node/UI boundaries.

CR review round: 1; reviewer: reused.

TT: Node179/179; native Standard14/14 and Lite12/12 passed. Typecheck, lint, Node/client production build, desktop frontend build and whitespace checks passed. No dependency changes, Docker image or desktop installer build.

ET: scenarios1–4 covered by fake protocol, actual status-only CLI probe, Node bridge tests and native real SQLite tests. Scenario5 passed in separate Playwright test session on the actual desktop frontend with controlled native IPC: inherited default, all options present, save-low/reload, save-before-check uses high, save-before-start uses xhigh, disabled while saving/running, provider switch hides but retains xhigh. In-app tool repeated its previously observed disabled-in-Work error; cause remains unknown. Native data/settings/credentials were untouched by browser fixture. Narrow layout is checked at the supported native minimum width760 (both Tauri configurations enforce minWidth760), not phone width390; existing desktop layout is not a phone surface.


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
