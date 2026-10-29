-- Hide a generated story using the same owner-scoped tombstone as the reader.
INSERT INTO library_deletions (user_id, story_id, kind, deleted_at)
SELECT user_id, id, 'generated', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM reader_sessions WHERE id = ?1
ON CONFLICT (user_id, story_id) DO NOTHING;
