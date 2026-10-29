# Purge obsolete book history

## Summary

Remove122 obsolete source paths and old Shidian种梨 data from local history. Preserve103 commits, their authors/messages/parent graph, all5 branches,4 safe captures and the current24-book application snapshot. Remove27 tainted Codex captures and stale local remote/pseudoref pointers; expire reflogs and prune obsolete objects. Active source notices now describe the completed local cleanup.

## Verification

The rewrite checked101,860per-commit non-source files. Old tip0aba301 maps to597dcc1 with an identical HEAD tree; current application bytes/modes, user CHANGELOG and all1,928 book originals remain unchanged. Original and cleaned Git integrity checks pass. All126 denied objects and the exact historical excerpt are absent across local refs/object storage. The after-audit.json report records the final object/root/manifest audit; no application runtime change required application tests/builds.

## Recovery and remote boundary

Private complete recovery backup: `/Users/esun/Documents/GitBackups/shiqu-history-20261029-z1z8vcw4/original.git`. Commit mapping, operation scripts and audit logs are in the same parent folder. This intentionally retains old material outside the repository and must remain private.

At cleanup activation, GitHub was unchanged. Original remote main: `3be9e59095dbb489462332e624015d1d3ce837dc`. A separate process subsequently pushed the cleaned history to main (see delivery verification below); this task did not perform that push. Fetching an old remote or clone can reintroduce old objects. Earlier delivery-document hashes refer to pre-cleanup history; consult the external commit map.

## Final acceptance review

VR passed: all acceptance criteria complete

VR risk: non-low — history cleanup requires preservation and removal evidence across commits, refs and stored objects.
VR review round: 1; reviewer: reused

1. **Complete — recoverable external backup.** Private backup contains original Git metadata, refs, state inventory and CHANGELOG; backup integrity check passed.
2. **Complete — obsolete sources removed locally.** The rewrite removes 122 obsolete source paths, three historical embedded-excerpt blobs and tainted capture refs. Current object inspection finds none of the 126 denied objects.
3. **Complete — application and history preserved.** Verification covers 103 commits, authors/messages/parent mappings and 101,860 per-commit file checks. Rewrite preserved the HEAD tree. Current inspection confirms 24 books and 1,928 original files with matching hashes; pre-existing tracked bytes remain unchanged except the two authorized source notices.
4. **Complete — user data and remote boundary preserved.** CHANGELOG remains unchanged. Operation scripts preserve the working tree and remote configuration. All five branches and four safe captures remain; the original remote tip is saved externally. No remote push or deletion occurred.
5. **Complete — integrity, scope and notices verified.** Git integrity and scoped rewrite checks passed. Notices accurately distinguish cleaned local history from unchanged GitHub history. Independent CR and VR passed.

The 4,129-object count describes the post-prune snapshot; current inspection sees 4,148 objects after the documentation commit, with all 126 denied objects still absent.

No application suites or mutations were executed during this review.

## Subsequent observation during demo work

A separate process fetched old remote objects and pushed cleaned94b38b1, as shown by origin/main reflog (update by push) and read-only ls-remote. This task did not perform that push. Obsolete objects were unreachable; another external full Git metadata backup was saved before re-expiring reflogs and pruning. Final post-demo audit at a819f2d confirms all126forbiddenobject IDs absent, zero old excerpt matches, zero old paths across111trees. Evidence:external backup post-demo-audit.json. Demo commits remain local.

## DD / GC delivery verification

User requested DD/GC for source cleanup. Fresh read-only ls-remote confirms origin/main94b38b17798ad16881362e834ef8a895f7386028. Active notices now record that observed state instead of claiming GitHub is still unchanged. Git integrity passes; the remaining dangling tree is a safe local snapshot. Fresh all-object/ref/path/excerpt and24-book hash verification is recorded outside the repository in delivery-source-cleanup-audit.json. The existing complete final VR above remains the acceptance record for the rewrite; subsequent demo code and artwork are separately owned.

GC commits only source-cleanup REQ/AP/DD and these two corrected source notices. Dongguo tracking documents and the pre-existing untracked CHANGELOG are excluded. No push is part of this delivery.
