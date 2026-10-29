ALTER TABLE `production_jobs` ADD `interrupted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reader_sessions` ADD `generation_mode` text DEFAULT 'reader' NOT NULL;--> statement-breakpoint
ALTER TABLE `reader_sessions` ADD `generation_control` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
-- Deletion from either the reader or desktop must revoke durable intent and old viewer leases.
CREATE TRIGGER production_disarm_deleted AFTER INSERT ON library_deletions BEGIN
 UPDATE reader_sessions SET generation_control='stopped'
 WHERE id=NEW.story_id AND user_id=NEW.user_id AND generation_mode='background';
 DELETE FROM production_demand WHERE session_id=NEW.story_id AND owner_id=NEW.user_id;
END;
