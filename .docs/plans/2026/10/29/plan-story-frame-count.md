# Story frame count

Story base: `e4a1106fe27337fa3a586acca7f9feb3be1b570c`.

## Decisions and boundaries

Preserve the existing persisted `selection.length` field: numeric 8/10/12 remain valid; extend to integer 1–60 or `auto` (new default). Persist the actual count in the existing plan pages, leaving `auto` intact as user intent. All runtime loops derive the resolved count from the saved plan; before planning, request only the first reading batch. No migration or extra model request.

Providers share schema and prompt semantics: auto permits 1–60 with 30–60 narrative guidance; numeric requires exact count. Scale Gemini's plan output budget to the requested upper bound so 60 scenes are not constrained by the old 8192 token ceiling. Retain existing deadlines, locks, retries and three-image batching.

The UI edits only a not-yet-created selection. A separate automatic/specified control exposes a slider and numeric input with a remembered manual value (initially 36). Existing stories have no count editor, so no destructive replan confirmation is necessary.

## Tasks

- [x] Extend shared count limits, selection/plan validation, provider schema/prompts, and count-aware generation/resume paths in `lib/reader-model.ts`, `lib/reader-generation-contract.ts`, `lib/reader-engine.ts`, `lib/reader-gemini.ts`, `lib/reader-generation.ts`, `server/generation.ts`, `client/ui/useStoryGeneration.ts`.
- [x] Extend reader advance/progress/events/media validation to frame 60 in `lib/reader-api.ts`, preserving per-story image readiness validation.
- [x] Replace length presets in `client/ui/Reader.tsx` with an accessible count picker and matching styles; show automatic/single/count labels before creation.
- [x] Add controlled provider/REST/resume regression scenarios for auto, 1, 30, 60, invalid counts, mismatched provider output, restart and high-index media/progress/events. Keep existing numeric coverage.
- [x] Run applicable full Node test suite, typecheck, lint and local production build using Node 24.22.1 / pnpm 11.25.0; no Docker builds.
- [x] Execute `.docs/tests/test-story-frame-count.md`, including browser picker verification with controlled local services.

## Review and risks

Risk: non-low — extends persisted selection semantics and public reader/provider boundaries across the client/server generation loop. Independent AR/CR/VR required. Existing numeric lengths remain compatible, but older binaries will not accept new auto/long sessions; rollback requires the updated reader or restoring a pre-feature data backup. More panels increase total generation cost and time; generation remains demand-driven.

First SS probe: use controlled Gemini/Codex responses and real local SQLite to establish auto plans resolve counts and high-index reader requests work without live inference. A failure blocks dependent UI verification until the contract is repaired and reviewed.

## Evidence

SS feasibility probe passed: Node 24.22.1 / pnpm 11.25.0, 18 targeted tests using both actual provider adapters, real temporary SQLite and FileMedia. Auto plans of 1 and 30, exact 1/8/10/12/30/60, mismatch rejection, frame-60 media/progress/events and restart all passed. No live inference.

AR passed: no blocking architecture flaws

AR risk: non-low — extends persisted selection semantics and reader/provider contracts across generation and resume.

AR review round: 1; reviewer: new.

Browser availability probe: the computer-use tool returned `Local browser use is disabled in Work settings` on discovery and direct iab creation. This does not establish that the user disabled a setting or is using Work; the underlying cause is unresolved. UI E2E used a separate Playwright session with temporary controlled data, disclosed to the user.


SS implementation milestone: `0dce9c3` (`feat(reader): support automatic and adjustable story frame counts`), with focused 18-test probe and typecheck passed before commit.

CR passed: no major findings

CR risk: non-low — persists expanded count intent and extends provider/reader boundaries.

CR review round: 1; reviewer: reused.

TT: full `pnpm test` passed 176/176 on Node 24.22.1 / pnpm 11.25.0. `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `git diff --check` passed. No additional applicable unit/integration suites for these reader changes; desktop native suites are outside scope.

ET: `.docs/tests/test-story-frame-count.md` scenarios 1–4 passed through the controlled provider REST tests. Scenario 5 passed in a separate Playwright browser against a temporary real local SQLite app with a controlled generation provider, without reading production data or calling inference. Verified auto default, manual 36, slider/number synchronization at 1/30/60, ArrowRight keyboard adjustment, 60 retained across auto/manual toggle, single label, disabled controls during session creation, POST length 1, rendered first/only frame and ending, and count controls only in new-story configuration. At viewport 390×844 the picker measured clientWidth=scrollWidth=332 (no horizontal overflow); inspected mobile screenshot. Browser console showed no errors (one development warning). A test locator initially expected “下一页” instead of the actual “读完，回味”; reading and ending were subsequently verified with the actual controls. Visual screenshot inspection found the existing global label style made mode labels and the numeric suffix stack vertically. Scoped row direction/margins and native input sizing were corrected in reader.css; affected UI, lint and build were rechecked.

Limits: controlled responses establish application contracts and UI behavior; the later real-model full-plan call hit the existing120-second cap; narrative quality and visual consistency could not be assessed. Existing saved numeric preferences remain selected until the user chooses auto. No database migration, Docker build or push.


SS styling milestone: `aef4d33` (`fix(reader): keep frame count controls aligned on mobile`). Rechecked picker row layout, 1/30/60 synchronization and remembered60; lint and build passed after the CSS repair.

CR passed: no major findings

CR risk: non-low — the story extends persisted count intent and reader/provider contracts; round 2 reviews only the scoped CSS repair and its interaction with global label/input styles.

CR review round: 2; reviewer: reused.

VR passed: all acceptance criteria complete

VR risk: non-low — coordinated client/server and persistence validation.

VR review round: 1; reviewer: reused.

All five criteria are evidenced: automatic planning, synchronized 1–60 controls, durable provider plans, single/60-frame reading and recovery, and legacy compatibility. Recorded verification: 176 tests, typecheck, lint, build and browser E2E passed.


Additional user-requested live trial: after clarification from the different historical Shiji Dongguo to Dongguo and the wolf, the historical attempt was cancelled. A single full-plan call to configured `gpt-6.1-sol` using the shared production auto prompt/schema and2610-character verified public-domain《中山狼传》timed out at the existing120-second runner limit; no count or plan was returned. A separate count-only preview succeeded in40644ms: gpt-6.1-sol recommended58 frames with beat allocations4/9/5/8/6/10/7/4/5 (sum58), including the old apricot tree and old ox retrospectives. The current30–60 guidance influenced this request; this is not a neutral/unprompted count or successful complete storyboard. Output: outputs/story-frame-count/dongguo-wolf-count-recommendation.json. This is material live evidence: controlled acceptance remains passed, but full-plan live readiness is not proven and the existing timeout may be inadequate for long automatic plans. No inference retry or timeout policy was changed in the application.


Final VR reassessment after the live timeout:

VR passed: all acceptance criteria complete
VR risk: non-low — provider and persistence contracts.
VR review round: 2; reviewer: reused.

The timeout does not invalidate the existing feature criteria or prove that the deadline needs changing.

The live full-plan trial **failed**: no count or plan returned within 120 seconds. Record that explicitly. A successful count-only preview would not verify the production planning flow.

Repeated full-plan timeouts would justify reopening runtime design. Increasing the deadline must account for the existing 180-second session lock.
