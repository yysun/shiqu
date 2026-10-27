CREATE TABLE `reader_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`selection` text NOT NULL,
	`document` text NOT NULL,
	`state` text DEFAULT 'idle' NOT NULL,
	`error` text,
	`step_key` text,
	`step_attempts` integer DEFAULT 0 NOT NULL,
	`lock_token` text,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`page` integer DEFAULT 0 NOT NULL,
	`saved` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reader_user_created` ON `reader_sessions` (`user_id`,`created_at`);