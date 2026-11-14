# Generate the next three scenes together

The local Node/React reader currently waits for one illustration at a time. Implement the behavior of main's three-image generation feature for this branch's existing Gemini and Codex providers, without cherry-picking its implementation.

- [x] Reading requests pages 1–3, then 4–6 on reaching page 4, continuing in groups of three and clamping the final group.
- [x] The first image completes alone as the reference; subsequent advances start up to three missing requested images concurrently with that reference and saved art direction.
- [x] Each successful image and usage record becomes durable and visible while the session lock stays held. Concurrent advances do not duplicate calls.
- [x] Partial failures settle all calls and retain successes; retry generates only missing images. Checkpoint write failures cannot report success or discard settled results when final persistence is available.
- [x] Leaving starts no further requests; deletion retains in-flight results without making the story visible again. Existing ownership and restart behavior remain intact.
- [x] Progress, including images finishing out of order, renews the client inactivity timeout; unchanged work and automatic retries remain bounded.
- [x] Both providers retain their existing routing and authentication contracts. Validate with controlled provider results and real local SQLite, without paid inference.

No provider, credential, schema, hosting, or unrelated UI changes. Source commit 3726dd9 defines the desired behavior only. Existing Node/React/Codex features remain in place.

Historical verification exercised both actual provider adapters through local REST/client generation with temporary SQLite and FileMedia. To keep routine changes short, provider-specific contracts and model-backed production suites were moved out of automatic checks on 2026-11-14. The local batch suite remains registered for on-demand execution with `pnpm test:models`; it retains batching, failure/retry, frame-count validation and frame-80 media checks. The separate manual scenarios below preserve an operational recipe for the full batch behavior. Existing automatic queue and reader contracts continue to cover non-model ownership and persistence boundaries.

VR passed: all acceptance criteria complete.
