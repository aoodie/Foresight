CREATE TABLE `ai_decision_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`ledger_id` text NOT NULL,
	`decision_type` text NOT NULL,
	`subject_key` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_decision_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`decision_type` text NOT NULL,
	`subject_key` text NOT NULL,
	`provider` text DEFAULT 'openai' NOT NULL,
	`model` text NOT NULL,
	`instructions` text NOT NULL,
	`input_json` text NOT NULL,
	`output_json` text NOT NULL,
	`validation_json` text,
	`response_id` text,
	`usage_json` text,
	`trigger` text NOT NULL,
	`created_at` text NOT NULL
);
