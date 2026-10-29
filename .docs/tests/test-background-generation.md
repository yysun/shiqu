# Background generation flows

1. Controlled isolated unfinished story: choose 后台生成整篇 on the shelf, leave/reload with no reader demand, and verify all pages complete using existing images once. Readable unfinished stories expose the same controls in reader settings.
2. Hold provider calls, pause from another window, release in-flight calls: results save, no refill. Restart: mode/control remain paused; reader POST/legacy advance cannot bypass. Resume keeps background mode and completes missing pages. Repeat with stop.
3. Stop service during active background generation and restart without opening story. Queued work resumes; simulate expired interrupted image and script claims and verify recovery after expiry with late-result fencing and no replay of successes. Reader-only stories remain demand-driven.
4. Fail a provider job: sibling results save, restart/passive polling never retries failed work. Explicit retry continues missing work. Global cap remains enforced across background and reader demands/providers.
5. Frame-count gate waits for confirmation with background selected. Deletion disarms background intent; restoration does not start work. Invalid action, foreign owner, cross-origin and completed-story controls are bounded/validated.
6. In-app browser: inspect shelf and reader controls/status, switch background, pause/stop/resume and reload against controlled isolated data. Verify desktop launcher with pnpm desktop:preview. No bundling, Docker, paid requests or changes to personal stories.
