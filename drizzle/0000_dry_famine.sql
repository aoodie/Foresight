CREATE TABLE `oanda_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text DEFAULT 'practice' NOT NULL,
	`token_ciphertext` text NOT NULL,
	`token_iv` text NOT NULL,
	`updated_at` text NOT NULL
);
