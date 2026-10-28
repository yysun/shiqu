# Local batch feature verification

Use the local Node application with a temporary real SQLite database and controllable generation, without live inference.

1. For 8, 10, and 12 pages, request the batch containing the reader's page. Observe page one alone, images two and three with its reference, no calls when revisiting saved pages, and a clamped final batch.
2. For both Gemini and Codex, hold three later image calls. Confirm all start together with the saved reference and art direction. Another advance must return running with no additional calls. Release out of order and inspect durable image/usage progress while locked.
3. Reject one call while others finish. Confirm all settle before lock release, completed results survive a restart, and retry requests only missing work. Inject an intermediate save failure and confirm the final save retains settled results while reporting failure.
4. Delete while three images run. Allow them to complete, verify stored results remain and visible reads/advances stay unavailable. Leaving the client during a batch must prevent a later batch from starting.
5. Simulate batches exceeding six minutes overall with advancing ready counts, including out-of-order results under an unchanged stage. Confirm progress continues, while unchanged work times out and existing retries remain bounded.
