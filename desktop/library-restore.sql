-- Undo desktop deletion without changing the story, progress, media, or paid checkpoints.
DELETE FROM library_deletions
WHERE story_id = ?1 AND kind = 'generated'
AND EXISTS (SELECT 1 FROM reader_sessions s WHERE s.id = story_id AND s.user_id = library_deletions.user_id);
