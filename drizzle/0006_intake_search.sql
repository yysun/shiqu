-- Move saved extraction out of the story's selection state, so it can no longer block or replace it.
-- Saved failures become search failures; invalid documents stay untouched and are skipped when read.
UPDATE reader_sessions
SET document=json_remove(json_set(document,
  '$.intake.search',json_object('round',1,'state',CASE WHEN state='failed' THEN 'failed' ELSE 'searching' END,'error',CASE WHEN state='failed' THEN error END),
  '$.intake.phase',CASE WHEN state='failed' OR json_type(document,'$.intake.selected')='object' THEN 'choosing' ELSE 'discovering' END),'$.intake.progress'),
 state='idle',error=NULL,lock_token=NULL,lock_until=0
WHERE CASE WHEN json_valid(document) THEN json_extract(document,'$.intake.phase')='discovering' ELSE 0 END;
-- Each search gets a new job id, so an old unfinished job could otherwise run beside it.
DELETE FROM production_jobs WHERE kind='discover' AND state!='succeeded';
