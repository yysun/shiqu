-- 记录未能安全转换的故事，保留该故事的原始数据供诊断。
CREATE TABLE IF NOT EXISTS production_migration_diagnostics (
 session_id TEXT NOT NULL, owner_id TEXT NOT NULL, code TEXT NOT NULL,
 PRIMARY KEY (session_id,owner_id)
);
PRAGMA user_version=4;

-- 候选扫描使用修订索引中的短字段，无需读取故事正文。
ALTER TABLE story_revisions ADD COLUMN owner_id TEXT;
ALTER TABLE story_revisions ADD COLUMN root_id TEXT;
ALTER TABLE story_revisions ADD COLUMN edition INTEGER NOT NULL DEFAULT 1;
ALTER TABLE story_revisions ADD COLUMN control TEXT NOT NULL DEFAULT 'active';
INSERT INTO story_revisions(story_id,rev,owner_id,root_id,edition,control)
 SELECT id,1,user_id,COALESCE(json_extract(CASE WHEN json_valid(document) THEN document ELSE '{}' END,'$.revision.rootId'),id),
 COALESCE(json_extract(CASE WHEN json_valid(document) THEN document ELSE '{}' END,'$.revision.number'),1),generation_control FROM stories WHERE 1
 ON CONFLICT(story_id) DO UPDATE SET owner_id=excluded.owner_id,root_id=excluded.root_id,edition=excluded.edition,control=excluded.control;
CREATE INDEX story_revisions_family ON story_revisions(owner_id,root_id,edition);
CREATE INDEX story_revisions_control ON story_revisions(control,story_id,owner_id,root_id,edition);
DROP INDEX stories_production_scan;
CREATE INDEX stories_production_scan ON stories(id,user_id);
DROP TRIGGER story_content_revision;
DROP TRIGGER story_content_revision_insert;
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

-- 派生版本用同一家族内的别名读取原始媒体文件，已有媒体路径保持有效。
CREATE TABLE production_media_aliases (
 alias_key TEXT PRIMARY KEY NOT NULL,
 session_id TEXT NOT NULL,
 source_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 root_id TEXT NOT NULL,
 target_key TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX production_media_aliases_source ON production_media_aliases(owner_id,source_id,target_key);

-- 图片可读性属于家族内的原文件；故障仍归属发起核对的版本。
CREATE TABLE production_media_health (
 owner_id TEXT NOT NULL,
 root_id TEXT NOT NULL,
 url TEXT NOT NULL,
 readable INTEGER NOT NULL,
 PRIMARY KEY(owner_id,root_id,url)
) WITHOUT ROWID;

-- 每份租约的执行过程以事件追加。任务行只负责队列领取与并发控制。
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

-- 故障是执行尝试日志的当前视图，调用与媒体核对产生的状态变化只追加事件。
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

-- 家族产物内容不可变。版本只记录自己选定的产物与该版本的审核、可读性标记。
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
