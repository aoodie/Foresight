CREATE TABLE `ai_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`key_ciphertext` text NOT NULL,
	`key_iv` text NOT NULL,
	`model` text DEFAULT 'gpt-5.5' NOT NULL,
	`updated_at` text NOT NULL
);
