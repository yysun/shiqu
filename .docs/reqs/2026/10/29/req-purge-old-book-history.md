# Purge obsolete book sources from Git history

Remove superseded book-source data from local Git history for public publishing. Preserve the existing commit/code history, current24-book snapshot and unrelated user work. User explicitly authorized history cleanup; remote mutation remains a separate action.

- [ ] A verified private recovery backup of all original Git metadata/refs and untracked CHANGELOG exists outside the repository before rewriting.
- [ ] Obsolete source paths and their historical blobs, including captured snapshots and duplicate paths, are absent from local refs and the cleaned object store. Remove historical embedded copies of the replaced Shidian种梨 excerpt without changing the current licensed excerpt.
- [ ] Current tracked application/data bytes and file modes are unchanged by rewriting; current24-book manifests still validate. Preserve code commits/branches, authorship and graph structure except required data redaction/changed commit IDs.
- [ ] Original untracked/ignored user data and remote configuration survive. No push, remote deletion or force-push occurs. Record the original remote tip for a future coordinated update.
- [ ] Git integrity checks, old-blob absence checks, scoped-history diff audit and independent reviews pass. Active source notices accurately describe local history cleanup and the remote boundary.
