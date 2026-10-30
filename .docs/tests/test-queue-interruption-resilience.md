# Queue interruption resilience flows

All flows use the controlled provider fixture with isolated SQLite and media through the REST API. No paid calls.

1. **Quit during an image.** An active 3-page story has page 0 in flight. Stop the service, end the call as a killed process would, and restart. The story reaches completed with no retry request, and the reader never receives the provider error.
2. **Quit during script work.** An active story has a planning call in flight. Stop the service, end the call, and restart. Planning runs again automatically and the story completes.
3. **Quit while paused or stopped.** A paused or stopped story has an image in flight. Stop, end the call, and restart. The story keeps its control with no new calls. Resume completes it with no retry request.
4. **Real and blocked failures.** A provider failure while running stays failed across restart until a retry. A storyboard review that becomes blocked during a stop stays failed, and no repair runs automatically.
5. **Transient error.** One scheduling cycle throws a database error. Generation continues on the next cycle, and new requests return 2xx.
6. **Unreadable story.** One story's selection contains an unknown art style, and others' documents are `{}`, `null` or truncated JSON with a queued job. Other stories complete, `GET /sessions` returns them, and the unreadable rows remain in the database.
7. **Laptop sleep.** All leases and locks are forced past expiry while a call is in flight. The next cycle keeps the claim, the finished image is published, and exactly one provider call is made.
8. **Crash loop.** A job abandoned by a dead service is recovered automatically twice, then stops at the third attempt with a retryable error and no fourth call. A retry completes the story.
