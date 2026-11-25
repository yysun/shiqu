-- 0.17.0 生产初始化后的 schema 与迁移回执。新书库直接读取此基线。

CREATE TABLE app_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`era` text NOT NULL,
	`source_url` text NOT NULL,
	`excerpt` text NOT NULL,
	`note` text NOT NULL
);

CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor` text NOT NULL,
	`session` text NOT NULL,
	`story_id` text NOT NULL,
	`kind` text NOT NULL,
	`page` integer,
	`mode` text NOT NULL,
	`cohort` text NOT NULL,
	`created_at` text NOT NULL
);

CREATE INDEX `events_cohort_date` ON `events` (`cohort`,`created_at`);

CREATE TABLE "stories" (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`selection` text NOT NULL,
	`document` text NOT NULL,
	`page` integer DEFAULT 0 NOT NULL,
	`saved` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
, `last_read_at` text, `generation_control` text DEFAULT 'active' NOT NULL, production_complete INTEGER NOT NULL DEFAULT 0);

CREATE INDEX `reader_user_created` ON "stories" (`user_id`,`created_at`);

CREATE TABLE `library_deletions` (
	`user_id` text NOT NULL,
	`story_id` text NOT NULL,
	`kind` text NOT NULL,
	`deleted_at` text NOT NULL
);

CREATE UNIQUE INDEX `library_deletions_user_story` ON `library_deletions` (`user_id`,`story_id`);

CREATE TABLE `production_demand` (
	`session_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`viewer_id` text NOT NULL,
	`page` integer NOT NULL,
	`through_page` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`runtime_id` text NOT NULL
);

CREATE UNIQUE INDEX `production_viewer` ON `production_demand` (`session_id`,`owner_id`,`viewer_id`);

CREATE INDEX `production_live_demand` ON `production_demand` (`runtime_id`,`expires_at`);

CREATE TABLE `production_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`pool` text NOT NULL,
	`version` text NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`state` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
, `interrupted` integer DEFAULT 0 NOT NULL, failure_id text, recovery_id text, error_code text);

CREATE INDEX `production_ready` ON `production_jobs` (`state`,`pool`,`priority`);

CREATE INDEX `production_session` ON `production_jobs` (`session_id`,`owner_id`);

CREATE TABLE book_image_references (
 owner_id TEXT NOT NULL,
 book_key TEXT NOT NULL,
 story_id TEXT NOT NULL,
 page INTEGER NOT NULL,
 token TEXT NOT NULL,
 asset_key TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,book_key)
);

CREATE TRIGGER book_image_reference_on_delete AFTER INSERT ON library_deletions
BEGIN
 DELETE FROM book_image_references WHERE owner_id=NEW.user_id AND story_id=NEW.story_id;
END;

CREATE TABLE reader_publication_defaults (
 owner_id TEXT PRIMARY KEY NOT NULL,
 publication TEXT NOT NULL
);

CREATE TABLE reader_commands (
 request_id text NOT NULL,
 owner_id text NOT NULL,
 session_id text NOT NULL,
 action text NOT NULL,
 fingerprint text NOT NULL,
 payload text NOT NULL,
 fault_id text,
 result_id text,
 status text DEFAULT 'succeeded' NOT NULL,
 result text,
 error text,
 created_at integer NOT NULL,
 updated_at integer NOT NULL,
 PRIMARY KEY(owner_id,request_id)
);

CREATE INDEX reader_commands_session ON reader_commands(session_id,owner_id);

CREATE TRIGGER reader_command_id_guard BEFORE INSERT ON reader_commands
 WHEN EXISTS(SELECT 1 FROM "stories" s WHERE s.id=NEW.request_id AND s.user_id=NEW.owner_id) BEGIN
 SELECT RAISE(ABORT,'reader_request_id_conflict');
END;

CREATE TRIGGER reader_session_id_guard BEFORE INSERT ON "stories"
 WHEN EXISTS(SELECT 1 FROM reader_commands c WHERE c.request_id=NEW.id AND c.owner_id=NEW.user_id) BEGIN
 SELECT RAISE(ABORT,'reader_request_id_conflict');
END;

CREATE TRIGGER books_refuse_pre_consolidation_seed BEFORE INSERT ON books
WHEN NEW.id='liaozhai' AND (NEW.source_url<>'' OR NEW.excerpt<>'')
BEGIN
 SELECT RAISE(ABORT,'BACKUP_APP_TOO_OLD: this library requires Shiqu 0.8.0 or later; update the app, or restore the pre-upgrade backup with its matching older app');
END;

CREATE TABLE story_revisions(
 story_id text PRIMARY KEY NOT NULL,
 rev integer NOT NULL DEFAULT 0
, owner_id TEXT, root_id TEXT, edition INTEGER NOT NULL DEFAULT 1, control TEXT NOT NULL DEFAULT 'active') WITHOUT ROWID;

CREATE TABLE prompt_records(
 id text PRIMARY KEY NOT NULL,
 record text NOT NULL
);

CREATE TABLE production_migration_diagnostics (
 session_id TEXT NOT NULL, owner_id TEXT NOT NULL, code TEXT NOT NULL,
 PRIMARY KEY (session_id,owner_id)
);

CREATE INDEX story_revisions_family ON story_revisions(owner_id,root_id,edition);

CREATE INDEX story_revisions_control ON story_revisions(control,story_id,owner_id,root_id,edition);

CREATE INDEX stories_production_scan ON stories(id,user_id);

CREATE TRIGGER story_content_revision AFTER UPDATE OF document,selection,generation_control ON stories
 WHEN NEW.document IS NOT OLD.document OR NEW.selection IS NOT OLD.selection OR NEW.generation_control IS NOT OLD.generation_control BEGIN
 INSERT INTO story_revisions(story_id,rev,owner_id,root_id,edition,control)
 VALUES(NEW.id,1,NEW.user_id,COALESCE(json_extract(CASE WHEN json_valid(NEW.document) THEN NEW.document ELSE '{}' END,'$.revision.rootId'),NEW.id),
  COALESCE(json_extract(CASE WHEN json_valid(NEW.document) THEN NEW.document ELSE '{}' END,'$.revision.number'),1),NEW.generation_control)
 ON CONFLICT(story_id) DO UPDATE SET rev=rev+1,owner_id=excluded.owner_id,root_id=excluded.root_id,edition=excluded.edition,control=excluded.control;
END;

CREATE TRIGGER story_content_revision_insert AFTER INSERT ON stories BEGIN
 INSERT INTO story_revisions(story_id,rev,owner_id,root_id,edition,control)
 VALUES(NEW.id,1,NEW.user_id,COALESCE(json_extract(CASE WHEN json_valid(NEW.document) THEN NEW.document ELSE '{}' END,'$.revision.rootId'),NEW.id),
  COALESCE(json_extract(CASE WHEN json_valid(NEW.document) THEN NEW.document ELSE '{}' END,'$.revision.number'),1),NEW.generation_control)
 ON CONFLICT(story_id) DO UPDATE SET rev=rev+1,owner_id=excluded.owner_id,root_id=excluded.root_id,edition=excluded.edition,control=excluded.control;
END;

CREATE TABLE production_media_aliases (
 alias_key TEXT PRIMARY KEY NOT NULL,
 session_id TEXT NOT NULL,
 source_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 root_id TEXT NOT NULL,
 target_key TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX production_media_aliases_source ON production_media_aliases(owner_id,source_id,target_key);

CREATE TABLE production_media_health (
 owner_id TEXT NOT NULL,
 root_id TEXT NOT NULL,
 url TEXT NOT NULL,
 readable INTEGER NOT NULL,
 PRIMARY KEY(owner_id,root_id,url)
) WITHOUT ROWID;

CREATE TABLE production_attempt_events (
 sequence INTEGER PRIMARY KEY,
 owner_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 attempt_id TEXT NOT NULL,
 event TEXT NOT NULL,
 recorded_at INTEGER NOT NULL,
 detail TEXT NOT NULL CHECK(json_valid(detail))
);

CREATE INDEX production_attempt_events_story ON production_attempt_events(owner_id,session_id,sequence);

CREATE INDEX production_attempt_events_attempt ON production_attempt_events(attempt_id,event,sequence);

CREATE INDEX production_attempt_events_job ON production_attempt_events(job_id,sequence);

CREATE INDEX production_attempt_events_paid_drawing ON production_attempt_events(owner_id,json_extract(detail,'$.rootId'),json_extract(detail,'$.inputHash'),sequence)
 WHERE event='paid-result';

CREATE INDEX production_attempt_events_repair ON production_attempt_events(owner_id,session_id,sequence)
 WHERE event IN ('repair-imported','repair-applied','repair-granted');

CREATE VIEW production_repair_budgets AS
 SELECT owner_id,session_id,SUM(COALESCE(json_extract(detail,'$.used'),0)) AS used,
  COALESCE(MAX(json_extract(detail,'$.limit')),20) AS capacity
 FROM production_attempt_events WHERE event IN ('repair-imported','repair-applied','repair-granted')
 GROUP BY owner_id,session_id;

CREATE TRIGGER production_attempt_reset AFTER UPDATE OF attempts ON production_jobs
 WHEN NEW.attempts=0 AND OLD.attempts<>0 AND NEW.state='queued' AND OLD.state!='running' BEGIN
 INSERT INTO production_attempt_events(owner_id,session_id,job_id,attempt_id,event,recorded_at,detail)
 VALUES(NEW.owner_id,NEW.session_id,NEW.id,'reset:'||NEW.id,'reset-attempts',NEW.updated_at,'null');
END;

CREATE TRIGGER production_attempt_new_queue AFTER INSERT ON production_jobs
 WHEN NEW.attempts=0 AND EXISTS (SELECT 1 FROM production_attempt_events WHERE job_id=NEW.id) BEGIN
 INSERT INTO production_attempt_events(owner_id,session_id,job_id,attempt_id,event,recorded_at,detail)
 VALUES(NEW.owner_id,NEW.session_id,NEW.id,'reset:'||NEW.id,'reset-attempts',NEW.updated_at,'null');
END;

CREATE INDEX production_attempt_events_fault ON production_attempt_events(json_extract(detail,'$.id'),sequence) WHERE event='fault';

CREATE VIEW production_faults AS
 SELECT json_extract(e.detail,'$.id') AS id,e.session_id,e.owner_id,NULLIF(e.job_id,'') AS job_id,
  json_extract(e.detail,'$.kind') AS kind,json_extract(e.detail,'$.node') AS node,json_extract(e.detail,'$.nodeKey') AS node_key,
  json_extract(e.detail,'$.inputHash') AS input_hash,json_extract(e.detail,'$.origin') AS origin_fault_id,
  json_extract(e.detail,'$.optional') AS optional,json_extract(e.detail,'$.version') AS version,json_extract(e.detail,'$.image') AS image,
  json_extract(e.detail,'$.message') AS message,
  CASE WHEN json_extract(e.detail,'$.state') IN ('pending','recovering') AND EXISTS (
   SELECT 1 FROM production_attempt_events settled WHERE settled.owner_id=e.owner_id AND settled.session_id=e.session_id
   AND settled.event='succeeded' AND settled.sequence>e.sequence
   AND (settled.job_id=e.job_id OR EXISTS(SELECT 1 FROM reader_commands command WHERE command.owner_id=e.owner_id
    AND command.request_id=json_extract(e.detail,'$.commandId') AND json_extract(command.payload,'$.resolutionJob')=settled.job_id))
   AND (json_extract(e.detail,'$.commandId') IS NULL OR json_extract(e.detail,'$.commandId')=json_extract(settled.detail,'$.recoveryId'))
  ) THEN 'resolved' ELSE json_extract(e.detail,'$.state') END AS state,
  json_extract(e.detail,'$.commandId') AS command_id,
  json_extract(e.detail,'$.createdAt') AS created_at,e.recorded_at AS updated_at
 FROM production_attempt_events e WHERE e.event='fault' AND NOT EXISTS (
  SELECT 1 FROM production_attempt_events newer WHERE newer.event='fault'
  AND json_extract(newer.detail,'$.id')=json_extract(e.detail,'$.id') AND newer.sequence>e.sequence);

CREATE TRIGGER production_fault_insert INSTEAD OF INSERT ON production_faults BEGIN
 INSERT INTO production_attempt_events(owner_id,session_id,job_id,attempt_id,event,recorded_at,detail)
 VALUES(NEW.owner_id,NEW.session_id,COALESCE(NEW.job_id,''),COALESCE(
  (SELECT attempt_id FROM production_attempt_events WHERE job_id=NEW.job_id ORDER BY sequence DESC LIMIT 1),'fault:'||NEW.id),
 'fault',NEW.updated_at,json_object('id',NEW.id,'kind',NEW.kind,'node',NEW.node,'nodeKey',COALESCE(NEW.node_key,''),
  'inputHash',NEW.input_hash,'origin',NEW.origin_fault_id,'optional',COALESCE(NEW.optional,0),'version',NEW.version,'image',NEW.image,
  'message',NEW.message,'state',COALESCE(NEW.state,'pending'),'commandId',NEW.command_id,'createdAt',NEW.created_at));
END;

CREATE TRIGGER production_fault_transition INSTEAD OF UPDATE ON production_faults BEGIN
 INSERT INTO production_attempt_events(owner_id,session_id,job_id,attempt_id,event,recorded_at,detail)
 SELECT NEW.owner_id,NEW.session_id,COALESCE(NEW.job_id,''),e.attempt_id,'fault',NEW.updated_at,
  json_object('id',NEW.id,'kind',NEW.kind,'node',NEW.node,'nodeKey',NEW.node_key,'inputHash',NEW.input_hash,'origin',NEW.origin_fault_id,
   'optional',NEW.optional,'version',NEW.version,'image',NEW.image,'message',NEW.message,'state',NEW.state,'commandId',NEW.command_id,'createdAt',NEW.created_at)
 FROM production_attempt_events e WHERE e.event='fault' AND json_extract(e.detail,'$.id')=OLD.id ORDER BY e.sequence DESC LIMIT 1;
END;

CREATE TABLE production_products (
 id INTEGER PRIMARY KEY,
 owner_id TEXT NOT NULL,
 root_id TEXT NOT NULL,
 target TEXT NOT NULL,
 input_hash TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 content TEXT NOT NULL CHECK(json_valid(content)),
 UNIQUE(owner_id,root_id,target,input_hash,content_hash)
);

CREATE INDEX production_products_family_input ON production_products(owner_id,root_id,input_hash,target,id);

CREATE TABLE production_product_refs (
 session_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 target TEXT NOT NULL,
 product_id INTEGER NOT NULL REFERENCES production_products(id),
 record TEXT NOT NULL CHECK(json_valid(record)),
 PRIMARY KEY(session_id,owner_id,target)
) WITHOUT ROWID;

CREATE INDEX stories_family ON stories(user_id,
   COALESCE(json_extract(CASE WHEN json_valid(document) THEN document ELSE '{}' END,'$.revision.rootId'),id),
   COALESCE(json_extract(CASE WHEN json_valid(document) THEN document ELSE '{}' END,'$.revision.number'),1),
   id,generation_control);

CREATE TRIGGER production_disarm_deleted AFTER INSERT ON library_deletions BEGIN
   UPDATE stories SET generation_control='stopped' WHERE id=NEW.story_id AND user_id=NEW.user_id;
   DELETE FROM production_demand WHERE session_id=NEW.story_id AND owner_id=NEW.user_id;
  END;

CREATE VIEW story_rows AS SELECT stories.*,
   (SELECT json_group_object(r.target,json_object('record',json(r.record),'content',json(p.content),'sharedReadable',m.readable))
    FROM production_product_refs r JOIN production_products p ON p.id=r.product_id AND p.owner_id=r.owner_id
    LEFT JOIN production_media_health m ON p.target LIKE 'frameImage:%' AND m.owner_id=p.owner_id AND m.root_id=p.root_id AND m.url=json_extract(p.content,'$')
    WHERE r.session_id=stories.id AND r.owner_id=stories.user_id) AS production_products,
   (SELECT json_object('used',e.used,'limit',e.capacity) FROM production_repair_budgets e
    WHERE e.session_id=stories.id AND e.owner_id=stories.user_id) AS production_repair_budget,
   CASE WHEN EXISTS(SELECT 1 FROM production_jobs j WHERE j.session_id=stories.id AND j.owner_id=stories.user_id AND j.kind!='landscape-print' AND j.state='running') THEN 'running'
    WHEN EXISTS(SELECT 1 FROM production_faults f WHERE f.session_id=stories.id AND f.owner_id=stories.user_id AND f.optional=0 AND f.state='pending') THEN 'failed'
    ELSE 'idle' END AS state,
   (SELECT f.message FROM production_faults f WHERE f.session_id=stories.id AND f.owner_id=stories.user_id AND f.optional=0 AND f.state='pending'
    ORDER BY f.created_at,f.id LIMIT 1) AS error
  FROM stories;

WITH baseline(name) AS (VALUES
 ('0000_bitter_dragon_lord.sql'),
 ('0001_perfect_lester.sql'),
 ('0002_absent_tempest.sql'),
 ('0003_flowery_jetstream.sql'),
 ('0004_background_generation.sql'),
 ('0005_single_generation_control.sql'),
 ('0006_intake_search.sql'),
 ('0007_original_story_label.sql'),
 ('0008_search_pool.sql'),
 ('0009_story_summary.sql'),
 ('0010_book_image_references.sql'),
 ('0011_publication_defaults.sql'),
 ('0012_generation_authorization.sql'),
 ('0013_reader_state_transitions.sql'),
 ('0014_reader_input_identity.sql'),
 ('0015_image_fault_checkpoints.sql'),
 ('0016_legacy_input_faults.sql'),
 ('0017_command_receipt_links.sql'),
 ('0018_consolidate_story_storage.sql'),
 ('0019_refuse_pre_consolidation_apps.sql'),
 ('0020_blocked_revision_faults.sql'),
 ('0021_landscape_job_isolation.sql'),
 ('0022_story_content_revisions.sql'),
 ('0023_story_scan_indexes.sql'),
 ('0024_prompt_records.sql'),
 ('0025_production_dag.sql'),
 ('0026_production_lifecycle.sql'),
 ('0027_revision_fault_targets.sql'),
 ('0028_production_spec.sql'),
 ('0029_finalize_production_spec.sql'),
 ('0030_rebind_production_receipts.sql')
)
INSERT INTO app_migrations(name,applied_at)
SELECT name,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM baseline;

PRAGMA user_version=4;
