# Story frame count — narrative detail and recommendation

## Summary

新故事先选简短/适中/详细（默认适中），再根据已保存原文推荐数量与一句理由。现有生成面板提供1–60同步滑块/数字、单幅概述和恢复推荐；用户确认后才生成精确数量的分镜及图片。新增可恢复推荐检查点和原子数量确认，避免刷新、并发和丢响应覆盖已确认选择。旧numeric/auto会话及已保存分镜继续沿原流程恢复，无数据库迁移。

Implementation milestone: `3a07851`. This correction supersedes the earlier auto/manual entry in the original story; original milestones `0dce9c3` and `aef4d33` remain intact. Final delivery documentation is included in the user's subsequently authorized local commit; no push.

## Verification

Independent AR/CR passed. Node24.22.1 / pnpm11.25.0: full187 tests, focused36 provider/source tests, typecheck, lint, production build and whitespace checks passed. Visible390px frontend used real local originals/SQLite and controlled Codex inference in a separate Playwright session; recommendation and final-plan contracts for both providers were tested separately. Screenshots: [detail options](../../../../../outputs/story-frame-count/detail-options-mobile.png), [recommendation](../../../../../outputs/story-frame-count/detail-recommendation-mobile.png).

UI verified default/three choices, old preference compatibility, reason, synchronized1/60 and keyboard/reset controls, one dialog/no overflow, shelf/reload recovery, disabled confirmation, lost confirmation response recovery with exactly one count1 plan/image, automatic failure exhaustion and manual retry. Initial fixture host rewrite was repaired in test setup; application origin checks remained intact. Temporary server/browser/data were closed and cleaned up.

Final independent VR, verbatim:

VR passed: all acceptance criteria complete

VR risk: non-low — durable recommendation and count confirmation coordinate source retrieval, providers, SQLite state, REST and reader UI.

VR review round: 1; reviewer: reused.

1. Complete — New UI offers 简短 / 适中 / 详细, defaults to 适中, and prevents old numeric preferences from skipping the new flow. Shared instructions define narrative density without fixed counts or a 30–60 quota. Provider tests cover all three values.

2. Complete — Gemini and Codex recommend an integer count and reason from the saved, verified original. Source failures and invalid recommendations stop before storyboard or image calls. Local receipt/anomaly tests protect recommendation input; final planning reuses the same original.

3. Complete — The existing generation sheet presents the suggestion, synchronized 1–60 controls, 单幅概述 and restoration of the recommended count. UI ET verifies keyboard adjustment and disabled controls during confirmation. Backend waiting-state enforcement and exact-count validation prevent early or mismatched generation.

4. Complete — Recommendation, original and confirmation persist across restart and shelf recovery. Controlled API/SQLite and UI evidence cover concurrent confirmations, repeated advances, lost responses, retry recovery and refresh without repeating completed work. Waiting remains idle and exits the automatic generation loop.

5. Complete — Optional new fields preserve legacy numeric/auto sessions and saved plans without a migration. Existing regression coverage retains single/60-frame reading, media, events, progress, restart, first-image reference and later image batches.

6. Complete — README documents the flow, extra text request, existing story quota and source limitations. Revised E2E scenarios are evidenced by real provider adapters with controlled responses, real SQLite/local originals and visible 390px frontend verification. Inspected screenshots show readable detail and recommendation controls.

Recorded validation: full Node suite 187/187; focused provider/source suite 36/36; typecheck, lint, production build and whitespace checks passed. All current AP tasks are complete. Independent AR and CR remain valid; implementation has not changed since `3a07851`.

No blocking findings. Review inspected artifacts, test output and screenshots without executing tests or editing files. Browser ET used a disclosed separate Playwright session because the in-app tool remained unavailable. Controlled inference establishes application behavior, not live-model narrative quality; unverifiable URL sources stop with an explicit source error. No Docker or desktop installer build was performed.

## Notes

The extra lightweight recommendation is a text request and uses the existing new-story quota; recovery does not create another session. Detail is narrative density, with no fixed count mapping or30–60 quota. Counts cannot change after confirmation. No actual inference, personal settings/story-data mutation, timeout/lease changes, Docker or desktop installer build. Current installed applications need a rebuilt package to expose these changes. Unknown/custom URL originals may be unavailable before planning and explicitly stop rather than receive a fabricated recommendation. Rollback to older code cannot interpret the new waiting state; preserve the updated reader or restore pre-feature data.
