CREATE TABLE `quant_automation_jobs` (
	`instrument` text PRIMARY KEY NOT NULL,
	`next_due_at` integer NOT NULL,
	`lease_until` integer NOT NULL,
	`lease_token` text,
	`completed_at` text,
	`result_json` text,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `quant_automation_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL
);
