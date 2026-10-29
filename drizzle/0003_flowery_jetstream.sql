CREATE TABLE `production_demand` (
	`session_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`viewer_id` text NOT NULL,
	`page` integer NOT NULL,
	`through_page` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`runtime_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_viewer` ON `production_demand` (`session_id`,`owner_id`,`viewer_id`);--> statement-breakpoint
CREATE INDEX `production_live_demand` ON `production_demand` (`runtime_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `production_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`pool` text NOT NULL,
	`version` text NOT NULL,
	`dependencies` text NOT NULL,
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
);
--> statement-breakpoint
CREATE INDEX `production_ready` ON `production_jobs` (`state`,`pool`,`priority`);--> statement-breakpoint
CREATE INDEX `production_session` ON `production_jobs` (`session_id`,`owner_id`);