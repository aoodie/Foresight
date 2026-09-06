CREATE TABLE `quant_automatic_history` (
	`id` text PRIMARY KEY NOT NULL,
	`instrument` text NOT NULL,
	`created_at` text NOT NULL,
	`result_json` text NOT NULL
);
