-- 横图任务独立显示失败，竖版的故障记录和完成状态不受影响。
DROP TRIGGER reader_job_failed;
--> statement-breakpoint
CREATE TRIGGER reader_job_failed AFTER UPDATE OF state ON production_jobs
 WHEN NEW.kind!='landscape-image' AND NEW.state='failed' AND (OLD.state!='failed' OR NEW.failure_id IS NOT OLD.failure_id) BEGIN
 UPDATE production_jobs SET failure_id=CASE
  WHEN NEW.failure_id IS NULL OR NEW.failure_id IS OLD.failure_id THEN lower(hex(randomblob(16)))
  ELSE NEW.failure_id END WHERE id=NEW.id;
 UPDATE reader_faults SET state='replaced',updated_at=NEW.updated_at
  WHERE session_id=NEW.session_id AND owner_id=NEW.owner_id AND state IN ('pending','recovering')
   AND (command_id=NEW.recovery_id OR job_id=NEW.id)
   AND id!=(SELECT failure_id FROM production_jobs WHERE id=NEW.id);
 INSERT INTO reader_faults(id,session_id,owner_id,job_id,kind,page,version,image,message,created_at,updated_at)
  SELECT failure_id,NEW.session_id,NEW.owner_id,NEW.id,
   CASE WHEN EXISTS(SELECT 1 FROM reader_faults f WHERE f.command_id=NEW.recovery_id AND f.owner_id=NEW.owner_id AND f.kind='image-loss') THEN 'image-loss'
    WHEN NEW.error LIKE '这幅图片的文件已丢失或损坏。%' THEN 'image-loss'
    WHEN NEW.interrupted=1 THEN 'interrupted' ELSE 'job' END,
   CASE WHEN NEW.kind='image' AND NEW.error LIKE '这幅图片的文件已丢失或损坏。%' THEN 0
    WHEN NEW.kind IN ('image','image-publish') THEN json_extract(NEW.payload,'$.page') END,
   NEW.version,(SELECT image FROM reader_faults f WHERE f.command_id=NEW.recovery_id AND f.owner_id=NEW.owner_id AND f.kind='image-loss' LIMIT 1),
   COALESCE(NEW.error,'制作未完成'),NEW.updated_at,NEW.updated_at
  FROM production_jobs WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET state='pending',message=excluded.message,updated_at=excluded.updated_at;
 UPDATE reader_commands SET status=CASE WHEN NEW.interrupted=1 AND NEW.attempts<3 THEN 'queued' ELSE 'failed' END,
  error=NEW.error,result=json_object('jobId',NEW.id,'faultId',(SELECT failure_id FROM production_jobs WHERE id=NEW.id)),updated_at=NEW.updated_at
  WHERE request_id=NEW.recovery_id AND owner_id=NEW.owner_id AND action='recover' AND status IN ('queued','running');
END;
