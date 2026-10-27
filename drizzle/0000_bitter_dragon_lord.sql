CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`era` text NOT NULL,
	`source_url` text NOT NULL,
	`excerpt` text NOT NULL,
	`note` text NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX `events_cohort_date` ON `events` (`cohort`,`created_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`kind` text NOT NULL,
	`page` integer,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`model` text,
	`usage` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `jobs_story` ON `jobs` (`story_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_running_job_per_story` ON `jobs` (`story_id`) WHERE "jobs"."status" = 'running';--> statement-breakpoint
CREATE TABLE `progress` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`story_id` text NOT NULL,
	`page` integer NOT NULL,
	`saved` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `progress_user_story` ON `progress` (`user_id`,`story_id`);--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`hook` text NOT NULL,
	`book_id` text NOT NULL,
	`theme` text NOT NULL,
	`status` text NOT NULL,
	`pages` text NOT NULL,
	`reflection` text NOT NULL,
	`source_text` text NOT NULL,
	`source_url` text NOT NULL,
	`adaptation_note` text NOT NULL,
	`checks` text NOT NULL,
	`actual_cost` real,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
