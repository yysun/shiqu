# Story frame count

## Summary

The reader no longer constrains new stories to 8/10/12 frames. New preferences default to model-decided pacing, with 30–60 narrative guidance and a validated 1–60 range. Readers can instead choose an exact count through synchronized native slider/number controls; one frame is labelled 单幅. Existing numeric preferences remain honored until changed.

Saved plan pages determine actual reading/generation length without changing automatic intent or replanning on retry. Both provider adapters enforce manual counts; reader media, events and saved progress now reach frame60. Existing 8/10/12 sessions need no migration. Images remain demand-driven in existing batches.

Implementation commits: `0dce9c3`, `aef4d33`.

## Verification

Node24.22.1 / pnpm11.25.0: full `pnpm test`176/176, typecheck, lint, local production build and whitespace checks passed. 18 controlled provider/REST tests cover auto1/30, exact1/8/10/12/30/60, mismatch rejection, saved plans, frame60 media/events/progress and restart. Separate-session Playwright E2E with temporary real SQLite and controlled generation verified picker keyboard/number/range behavior, creation lock, a single-frame read and ending, and 390px mobile layout. The in-app automation tool returned a disabled-in-Work error; its underlying cause is unknown, not evidence that the user is using Work or changed a setting.

Independent AR and full CR passed; CSS repair passed a second CR. Final independent VR:

VR passed: all acceptance criteria complete
VR risk: non-low — provider and persistence contracts.
VR review round: 2; reviewer: reused.

The timeout does not invalidate the existing feature criteria or prove that the deadline needs changing.

The live full-plan trial **failed**: no count or plan returned within 120 seconds. Record that explicitly. A successful count-only preview would not verify the production planning flow.

Repeated full-plan timeouts would justify reopening runtime design. Increasing the deadline must account for the existing 180-second session lock.

## Notes

No database migration, Docker build or push. Unrelated concurrent desktop and icon work was preserved. Automatic count influences total generation time/cost; a real model can still fail or time out, and narrative/visual quality is not established by controlled tests.


The user additionally requested a real Dongguo/wolf trial. A full plan under the production prompt/schema with configured `gpt-6.1-sol` timed out at the existing120-second limit. It returned no usable count or plan. This establishes a concrete runtime limit for this trial; it is not a successful full-plan verification. A separate count-only preview is distinct from the app's complete storyboard generation.


The separate count-only preview succeeded in40.644s: `gpt-6.1-sol` recommended **58 frames** for the complete《中山狼传》. Nine beat allocations were4/9/5/8/6/10/7/4/5; the old apricot tree and old ox episodes contribute16 frames. This used the current30–60 guidance and is not an unbiased count. No images were generated. Evidence: `outputs/story-frame-count/dongguo-wolf-count-recommendation.json`; source: https://zh.wikisource.org/w/index.php?title=%E4%B8%AD%E5%B1%B1%E7%8B%BC%E5%82%B3&oldid=2578885 .
