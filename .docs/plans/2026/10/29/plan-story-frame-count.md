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
- [ ] Run applicable full Node test suite, typecheck, lint and local production build using Node 24.22.1 / pnpm 11.25.0; no Docker builds.
- [ ] Execute `.docs/tests/test-story-frame-count.md`, including in-app browser picker verification with controlled local services.

## Review and risks

Risk: non-low — extends persisted selection semantics and public reader/provider boundaries across the client/server generation loop. Independent AR/CR/VR required. Existing numeric lengths remain compatible, but older binaries will not accept new auto/long sessions; rollback requires the updated reader or restoring a pre-feature data backup. More panels increase total generation cost and time; generation remains demand-driven.

First SS probe: use controlled Gemini/Codex responses and real local SQLite to establish auto plans resolve counts and high-index reader requests work without live inference. A failure blocks dependent UI verification until the contract is repaired and reviewed.

## Evidence

SS feasibility probe passed: Node 24.22.1 / pnpm 11.25.0, 18 targeted tests using both actual provider adapters, real temporary SQLite and FileMedia. Auto plans of 1 and 30, exact 1/8/10/12/30/60, mismatch rejection, frame-60 media/progress/events and restart all passed. No live inference.

AR passed: no blocking architecture flaws

AR risk: non-low — extends persisted selection semantics and reader/provider contracts across generation and resume.

AR review round: 1; reviewer: new.

Browser availability probe: in-app browser disabled in Work settings. UI E2E will use a separate Playwright session with temporary controlled data, disclosed to the user.
