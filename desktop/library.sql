-- Read-only desktop summaries, shared by the native shell and loopback-only Vite preview.
-- Match jobs and deletions by owner as well as story; never return prompts, keys, or job payloads.
WITH job_counts AS (
 SELECT session_id, owner_id, count(*) AS jobs,
  sum(state = 'queued') AS queued, sum(state = 'running') AS running,
  sum(state = 'failed') AS failed, sum(state = 'succeeded') AS succeeded
 FROM production_jobs GROUP BY session_id, owner_id
)
SELECT json_object('stories', json_group_array(json(summary))) FROM (
 SELECT json_object(
  'id', s.id,
  'title', coalesce(json_extract(s.document, '$.plan.title'), nullif(json_extract(s.selection, '$.storyTitle'), ''), '还在展开的故事'),
  'book', coalesce(b.title, json_extract(s.selection, '$.customBook'), json_extract(s.selection, '$.bookId')),
  'theme', json_extract(s.selection, '$.theme'),
  'artStyle', coalesce(json_extract(s.selection, '$.artStyle'), 'ink-pencil'),
  'state', s.state, 'saved', s.saved, 'page', s.page,
  'ready', (SELECT count(*) FROM json_each(s.document, '$.images') WHERE value IS NOT NULL AND value != ''),
  'total', coalesce(json_array_length(s.document, '$.plan.pages'), 0),
  'updatedAt', s.updated_at,
  'jobs', coalesce(j.jobs, 0), 'queued', coalesce(j.queued, 0),
  'running', coalesce(j.running, 0), 'failed', coalesce(j.failed, 0), 'succeeded', coalesce(j.succeeded, 0)
 ) AS summary
 FROM reader_sessions s
 LEFT JOIN books b ON b.id = json_extract(s.selection, '$.bookId')
 LEFT JOIN job_counts j ON j.session_id = s.id AND j.owner_id = s.user_id
 WHERE NOT EXISTS (SELECT 1 FROM library_deletions d WHERE d.story_id = s.id AND d.user_id = s.user_id)
 ORDER BY coalesce(s.last_read_at, s.created_at) DESC
);
