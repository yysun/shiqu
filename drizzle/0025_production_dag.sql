-- 0025 制作 DAG：故障按节点实例记录，任务记录结构化错误码，承载制作规则的触发器移入应用事务，书库格式升为 2。
-- 故事文档的 v1 → v2 转换、旧图片结果的采用与无页码旧故障的节点归属由代码钩子 server/dag-migration.ts
-- 在本迁移的 SQL 之后、同一事务内完成。本迁移在发布前就地修改，不另加迁移。

-- 制作规则改由应用在事务中处理；保留与制作规则无关的完整性触发器。
DROP TRIGGER IF EXISTS reader_job_failed;
DROP TRIGGER IF EXISTS reader_job_queued;
DROP TRIGGER IF EXISTS reader_job_running;
DROP TRIGGER IF EXISTS reader_job_succeeded;
DROP TRIGGER IF EXISTS reader_job_deleted;
DROP TRIGGER IF EXISTS reader_control_command;
DROP TRIGGER IF EXISTS reader_override_command;
DROP TRIGGER IF EXISTS reader_recover_command;
DROP TRIGGER IF EXISTS reader_recovery_adopt;
DROP TRIGGER IF EXISTS reader_image_lost;
DROP TRIGGER IF EXISTS reader_image_restored;
DROP TRIGGER IF EXISTS reader_intake_command;
DROP TRIGGER IF EXISTS reader_search_command;
DROP TRIGGER IF EXISTS reader_replace_receipt;
DROP TRIGGER IF EXISTS reader_intake_fault_generation;
DROP TRIGGER IF EXISTS reader_legacy_failure;
DROP TRIGGER IF EXISTS reader_legacy_fault_lineage;
DROP TRIGGER IF EXISTS stories_blocked_revision_fault;

ALTER TABLE production_jobs ADD COLUMN error_code text;

-- 故障按节点实例记录：node 与 node_key 取代页码；input_hash 用于随修订延续；awaiting-match 为待匹配状态。
CREATE TABLE reader_faults_next(
 id text PRIMARY KEY NOT NULL,
 session_id text NOT NULL,
 owner_id text NOT NULL,
 job_id text,
 kind text NOT NULL,
 node text,
 node_key text NOT NULL DEFAULT '',
 input_hash text,
 origin_fault_id text,
 optional integer NOT NULL DEFAULT 0,
 version text NOT NULL,
 image text,
 message text NOT NULL,
 state text NOT NULL DEFAULT 'pending',
 command_id text,
 created_at integer NOT NULL,
 updated_at integer NOT NULL
);
-- 有页码的旧故障属于该页成图，画幅身份与转换一致（legacy-<页码+1>）；没有页码的由代码钩子归属。
INSERT INTO reader_faults_next(id,session_id,owner_id,job_id,kind,node,node_key,version,image,message,state,command_id,created_at,updated_at)
 SELECT id,session_id,owner_id,job_id,kind,
  CASE WHEN page IS NULL THEN NULL ELSE 'frameImage' END,
  CASE WHEN page IS NULL THEN '' ELSE 'legacy-'||(page+1) END,
  version,image,message,state,command_id,created_at,updated_at
 FROM reader_faults;
DROP TABLE reader_faults;
ALTER TABLE reader_faults_next RENAME TO reader_faults;
CREATE INDEX reader_faults_session ON reader_faults(session_id,owner_id,state);
CREATE UNIQUE INDEX reader_faults_image ON reader_faults(session_id,owner_id,node,node_key) WHERE kind='image-loss' AND state IN ('pending','recovering');

PRAGMA user_version=2;
