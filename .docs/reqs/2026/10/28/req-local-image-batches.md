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

Verification evidence: `tests/local-image-batches.test.mjs` exercises both actual provider adapters through local REST/client generation with temporary SQLite and FileMedia. Its 11 tests cover all seven criteria: 8/10/12-page batches and reference/art direction; lock-held out-of-order progress and duplicate advances; settled failures, restart and retry; checkpoint failure and token loss; deletion and leaving; progress/stall timeout. Existing generation and Codex tests cover owner scope, bounded automatic retries and authentication isolation.

VR passed: all acceptance criteria complete.
