# One shared story library

Development currently defaults to .data/dev while desktop uses Application Support, so the same person sees different shelves. Both entry points must read one library, including the existing 东郭先生 story, without losing stories or media.

- [x] Development follows the desktop-configured library by default (macOS ~/Library/Application Support/com.shiqu.desktop/library); explicit SHIQU_DATA_DIR still works and .env is respected. Desktop credentials are never read or copied into web configuration.
- [x] Back up both existing stores, stop their writers, and merge all story/session/progress/event/deletion/job records and referenced media into the Application Support library. Preserve original stores/backups and verify all original story IDs and media hashes, including 东郭先生's script, source, generated images and queue receipts.
- [x] Both current entry points use the merged library and compatible queue runtime. Verify identical shelves, cross-entry progress/media, duplicate paid-call exclusion and independent demand/shutdown with concurrent readers. Desktop authentication remains required and the development remains LAN-accessible for phone testing with a pairing-protected API, preventing an unauthenticated LAN path.
- [x] Relevant automated checks and a real read-only verification of both live entry points pass. Preserve unrelated working changes and document the shared path, explicit overrides, migration evidence and restart behavior.

No Docker build, remote sync, new paid generation test, credential migration, or deletion of either source library. Conflicting generated sessions or paid media must stop consolidation rather than silently overwrite data. Conflicting published sample versions are preserved under distinct IDs with imported references remapped and recorded.

Verified2026-10-29: independent VR passed all four criteria. Full222 tests and live desktop/development/LAN checks passed; details and backup locations are in the completion report.
