CREATE TABLE `library_deletions` (
	`user_id` text NOT NULL,
	`story_id` text NOT NULL,
	`kind` text NOT NULL,
	`deleted_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_deletions_user_story` ON `library_deletions` (`user_id`,`story_id`);--> statement-breakpoint
ALTER TABLE `reader_sessions` ADD `last_read_at` text;