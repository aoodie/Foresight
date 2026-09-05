CREATE TABLE `execution_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`request_json` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text
);
--> statement-breakpoint
CREATE TABLE `model_profiles` (
	`role` text PRIMARY KEY NOT NULL,
	`protocol` text NOT NULL,
	`model` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quant_history` (
	`key` text PRIMARY KEY NOT NULL,
	`bars_json` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quant_research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`dataset_hash` text NOT NULL,
	`report_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trade_entry_context` (
	`journal_id` text PRIMARY KEY NOT NULL,
	`captured_at` text NOT NULL,
	`context_json` text NOT NULL
);
