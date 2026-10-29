# Git history cleanup flows

1. Before rewrite: snapshot HEAD/ref map/index/current tracked files/untracked CHANGELOG and full Git metadata to a private folder outside the repository. Restore-read the backup and confirm identical refs/HEAD and Git integrity.
2. Independent mirror: remove exactly the enumerated obsolete source paths/blob copies and old embedded source literals. Verify current tracked HEAD tree unchanged and all commits retain non-source files, authors and parent mapping; unaffected branches/captures remain.
3. Activation: compare original live refs/index/status/files to the snapshot. Apply all ref updates atomically with expected-old hashes; any concurrent change aborts. Original remote remains unchanged and its old tip is saved outside the repository.
4. After cleanup: removed path/blob/literal counts are zero across local refs and object store; fsck passes;24 current book manifests validate; tracked application/data bytes and user CHANGELOG are unchanged. Backup remains independently recoverable. Source notices distinguish cleaned local history from unchanged GitHub history.
