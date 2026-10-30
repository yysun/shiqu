-- Read-only desktop summaries, shared by the native shell and loopback-only Vite preview.
-- Match jobs and deletions by owner as well as story; never return prompts, keys, or job payloads.
-- Recover complete choice checkpoints without writes; compare source-range leaves independent of key order.
WITH selected_sessions AS (
 SELECT s.*, CASE WHEN json_type(document,'$.intake.selected.batch')='integer' AND json_extract(document,'$.intake.selected.batch')>=0
  AND json_type(document,'$.intake.selected.index')='integer' AND json_extract(document,'$.intake.selected.index')>=0
  THEN json_extract(document,'$.intake.batches['||json_extract(document,'$.intake.selected.batch')||'].stories['||json_extract(document,'$.intake.selected.index')||']') END AS selected_candidate
 FROM reader_sessions s
), prepared_sessions AS (
 SELECT s.*, CASE WHEN json_extract(document,'$.intake.phase')='choosing' AND json_extract(document,'$.plan') IS NULL
  AND json_extract(selected_candidate,'$.title')=json_extract(selection,'$.storyTitle')
  AND json_type(document,'$.original.text')='text' AND length(trim(json_extract(document,'$.original.text')))>0
  AND json_type(document,'$.frameRecommendation.count')='integer' AND json_extract(document,'$.frameRecommendation.count') BETWEEN 1 AND 80
  AND json_type(document,'$.frameRecommendation.reason')='text' AND length(trim(json_extract(document,'$.frameRecommendation.reason')))>0
  AND NOT EXISTS (
   SELECT fullkey,type,atom FROM (
    SELECT fullkey,path,key,type,atom FROM json_tree(json_extract(selected_candidate,'$.source'))
    UNION ALL SELECT fullkey,path,key,type,atom FROM json_tree(json_extract(selection,'$.source'))
    UNION ALL SELECT fullkey,path,key,type,atom FROM json_tree(json_extract(document,'$.original.localSource'))
   ) WHERE (path='$' AND key IN ('edition','sectionId','firstUnit','lastUnit'))
    OR (path LIKE '$.continuations[%]' AND key IN ('sectionId','firstUnit','lastUnit'))
   GROUP BY fullkey,type,atom HAVING count(*)!=3
  ) THEN 'confirming' ELSE json_extract(document,'$.intake.phase') END AS intake_phase
 FROM selected_sessions s
), job_counts AS (
 SELECT j.session_id, j.owner_id, count(*) AS jobs,
  sum(j.state = 'queued') AS queued, sum(j.state = 'running') AS running,
  sum(j.state = 'failed') AS failed, sum(j.state = 'succeeded') AS succeeded
 FROM production_jobs j JOIN reader_sessions r ON r.id=j.session_id AND r.user_id=j.owner_id
 WHERE json_extract(r.document,'$.intake.generation') IS NULL OR json_extract(j.payload,'$.setupGeneration')=json_extract(r.document,'$.intake.generation')
  OR (j.kind='discover' AND j.state IN ('queued','running') AND json_extract(r.document,'$.intake.phase')='discovering')
 GROUP BY j.session_id, j.owner_id
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
  'total', coalesce(json_array_length(s.document, '$.plan.pages'), json_array_length(s.document, '$.storyboard.outline.beats'), CASE WHEN json_type(s.selection, '$.length') = 'integer' THEN json_extract(s.selection, '$.length') END, 0),
  'production', json_object(
   'intakePhase', s.intake_phase,
   'candidateBatches', json_array_length(s.document,'$.intake.batches'),
   'reviewAudits', json_array_length(s.document,'$.visualReview.reports'),
   'repairBatches', json_array_length(s.document,'$.visualReview.history'),
   'repairPasses', json_extract(s.document,'$.visualReview.repairs'),
   'reviewStopReason', json_extract(s.document,'$.visualReview.stopReason'),
   'reviewOverridden', json_extract(s.document,'$.visualReview.overridden'),
   'planReady', json(CASE WHEN json_type(s.document, '$.plan') = 'object' THEN 'true' ELSE 'false' END),
   'sourceReady', json(CASE WHEN json_type(s.document, '$.original') = 'object' THEN 'true' ELSE 'false' END),
   'frameCountConfirmed', json(CASE WHEN json_type(s.document, '$.plan') = 'object' OR json_type(s.document, '$.storyboard') = 'object' OR json_extract(s.document, '$.frameCountConfirmed') = 1 OR (json_type(s.selection, '$.narrativeDetail') IS NULL AND json_type(s.selection, '$.length') = 'integer') THEN 'true' ELSE 'false' END),
   'phase', CASE
    WHEN s.intake_phase='discovering' THEN 'discover'
    WHEN s.intake_phase='choosing' THEN 'story-choice'
    WHEN s.intake_phase='confirming' THEN 'production-confirmation'
    WHEN json_type(s.document, '$.storyboard') = 'object' AND json_type(s.document, '$.original') IS NOT 'object' THEN 'source'
    WHEN json_type(s.document, '$.plan') IS NOT 'object' THEN CASE
     WHEN json_type(s.selection, '$.narrativeDetail') IS NOT NULL AND json_type(s.document, '$.frameRecommendation') IS NOT 'object' THEN 'recommend'
     WHEN json_type(s.selection, '$.narrativeDetail') IS NOT NULL AND coalesce(json_extract(s.document, '$.frameCountConfirmed'), 0) = 0 THEN 'frame-count'
     ELSE 'plan' END
    WHEN json_type(s.document, '$.original') IS NOT 'object' THEN 'source'
    WHEN json_extract(s.document, '$.visualReview.status') = 'repair' THEN 'repair'
    WHEN json_extract(s.document, '$.visualReview.status') IN ('pending', 'blocked') THEN 'review'
    ELSE 'image' END,
   'storyboardFrames', json_array_length(s.document, '$.storyboard.pages'),
   'reviewStatus', json_extract(s.document, '$.visualReview.status'),
   'reviewRound', coalesce(json_extract(s.document, '$.visualReview.round'), 0),
   'repairCompleted', coalesce(json_array_length(s.document, '$.visualReview.repaired'), 0),
   'repairTotal', coalesce(json_array_length(s.document, '$.visualReview.issues'), 0)
  ),
  'updatedAt', s.updated_at,
  'jobs', coalesce(j.jobs, 0), 'queued', coalesce(j.queued, 0),
  'running', coalesce(j.running, 0), 'failed', coalesce(j.failed, 0), 'succeeded', coalesce(j.succeeded, 0)
 ) AS summary
 FROM prepared_sessions s
 LEFT JOIN books b ON b.id = json_extract(s.selection, '$.bookId')
 LEFT JOIN job_counts j ON j.session_id = s.id AND j.owner_id = s.user_id
 WHERE NOT EXISTS (SELECT 1 FROM library_deletions d WHERE d.story_id = s.id AND d.user_id = s.user_id)
 ORDER BY coalesce(s.last_read_at, s.created_at) DESC
);
