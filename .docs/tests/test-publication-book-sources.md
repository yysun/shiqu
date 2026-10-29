# Replacement source flows

1. Fresh library, all 24 books: load originals offline; check declared complete chapter sequences, final chapter bodies, bounded exhaustive inputs, expected source URLs and immutable hashes. Mock provider selects real receipts via HTTP; original text is persisted before planning. No paid calls.
2. Modified/missing/extra/path-escaping originals: loading returns unavailable, never a different edition or remote fallback. Stale edition receipts are rejected. Unsupported glyph ranges remain unselectable.
3. Fresh SQLite: 种梨 demo has the independently sourced passage, attribution and ten existing bundled images. Reopen an existing saved session carrying an older edition/source; keep its saved original and media unchanged.
4. Current tree and packaging: 17 old source paths absent, seven retained hash sets unchanged, all replacement manifests checked; text licenses and modifications documented separately from Apache code. Git history is explicitly outside removal scope.
