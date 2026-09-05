CREATE TABLE `trade_journal_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_key` text NOT NULL,
	`journal_id` text NOT NULL,
	`broker_trade_id` text,
	`event_type` text NOT NULL,
	`event_at` text NOT NULL,
	`source` text NOT NULL,
	`status` text,
	`price` real,
	`pnl` real,
	`reason` text,
	`metadata_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_journal_events_event_key_unique` ON `trade_journal_events` (`event_key`);
