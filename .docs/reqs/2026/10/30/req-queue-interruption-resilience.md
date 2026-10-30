# Queue interruption resilience

Every new story now generates in the background, so interruptions are normal rather than exceptional. Today a service stop can turn in-flight work into a permanent failure, one error can halt generation for every story until restart, and a lost lease can discard a finished paid image and pay for it again without limit.

## Acceptance criteria

### Service stop

- [ ] A provider call that ends because the service is stopping, including the desktop app killing Codex processes, is recorded as an interruption rather than a provider failure. This holds for image and for script/preparation work.
- [ ] After restart, an active story resumes interrupted work without a manual retry, and reuses every saved result. The reader never sees a subscription or login error caused by the stop.
- [ ] A paused or stopped story stays that way across the restart. Resume then continues the interrupted work without a manual retry.
- [ ] Real provider failures that happen while the service is running, and deterministic failures such as a blocked storyboard review, still stay failed until an explicit retry, including when they surface during a stop.

### Failure isolation

- [ ] A transient error during one scheduling cycle stops only that cycle. The next cycle dispatches normally, and API requests are not refused because of the earlier error.
- [ ] A story whose saved selection or document cannot be read does not stop other stories from generating and does not stop the shelf from loading. Its saved data is retained.
- [ ] Failing to persist one job's outcome, whether success or failure, does not silently stop the queue while the API keeps accepting work, and is not reported as a provider failure. That job recovers through normal interruption handling.
- [ ] While the database cannot be written, the queue dispatches no new paid work.
- [ ] A shutdown that hits a transient scheduling error still drains and closes the database.

### Leases and replays

- [ ] With one service using the library, a provider call that is still running keeps its job and session claims across a long clock jump such as laptop sleep. Its result is saved and no second provider call is made. If a second service shares the library, it may treat a sleeping service as dead and replay the call; the sleeping service's late result is then fenced out.
- [ ] A late result from an attempt that has been replaced still cannot overwrite the replacement. Attempts abandoned by a dead service are still recovered after their lease expires.
- [ ] Automatic recovery runs a job at most three times in total. After that the story shows a retryable interruption and makes no more automatic paid calls for that job.
- [ ] An explicit retry restores the automatic recovery allowance for the whole story. A claim released before its handler starts does not use up the allowance.

## Constraints

- Use the existing SQLite schema; no migration. Interrupted jobs that were already recorded keep working.
- Preserve owner scope, deletion disarm, frame-count confirmation, publication drain on shutdown, and the existing pause and resume behaviour.
- Log only safe codes and story IDs; never provider responses or story content.
- Verify with controlled providers only: no paid calls, Docker builds or desktop packaging.

## Non-goals

- Regenerating images whose saved files are missing, reader-position priority, tick cost reduction, job or artifact cleanup, and removing legacy viewer-demand code. The queue review recorded these separately.
- Provider-side job lookup, or automatic retries of real provider failures.
- Repairing stories already marked failed by earlier versions. An explicit retry still recovers them.
- Displaying or repairing a story whose saved data cannot be read.
