# Empty first run and existing library compatibility

1. Fresh isolated database: GET stories and progress empty; admin seed and reopen remain empty;24 book choices still present. Browser discovers books/creation action and empty bookshelf, no demo art or sample links.
2. Existing fixture: store ordinary saved story with /art/pear-1.png and another /art/dongguo-1.png plus generated session/progress. Copy legacy images into private media. Start/reseed/reopen: exact row data/progress unchanged, both GET/HEAD images readable at old URLs, invalid paths/missing files fail closed, symlinked private media cannot escape.
3. Actual user libraries: read-only pre/post row snapshots equal; copied needed images match original hashes; existing generated Dongguo session30pages/art preserved. Never delete/reset existing stories or generate.
4. History: recoverable external backup, independent mirror scoped redaction with identical intended tip, preserved branch/commit/code graph, all-object denied demo absence, fsck and24-book hashes. Remote unchanged by this task; stale local origin ref handled separately from remote state.
