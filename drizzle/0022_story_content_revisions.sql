-- 故事内容修订号：任何写入 document 或 selection 的语句都会使修订号加一，制作节拍据此只读取有变化的故事。
-- 修订号放在独立小表，避免触发器重写大行，也不改变 stories 的列；插入同样加一，修订号只增不减。
CREATE TABLE story_revisions(
 story_id text PRIMARY KEY NOT NULL,
 rev integer NOT NULL DEFAULT 0
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TRIGGER story_content_revision AFTER UPDATE OF document,selection ON stories
 WHEN NEW.document IS NOT OLD.document OR NEW.selection IS NOT OLD.selection BEGIN
 INSERT INTO story_revisions(story_id,rev) VALUES(NEW.id,1) ON CONFLICT(story_id) DO UPDATE SET rev=rev+1;
END;
--> statement-breakpoint
CREATE TRIGGER story_content_revision_insert AFTER INSERT ON stories BEGIN
 INSERT INTO story_revisions(story_id,rev) VALUES(NEW.id,1) ON CONFLICT(story_id) DO UPDATE SET rev=rev+1;
END;
--> statement-breakpoint
-- 覆盖索引让节拍的轻量查询无需读取故事行（state 位于 document 之后）。
CREATE INDEX stories_production_scan ON stories(id,user_id,state);
