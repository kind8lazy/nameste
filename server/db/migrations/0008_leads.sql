CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text DEFAULT 'telegram' NOT NULL,
	`external_id` text NOT NULL,
	`tg_chat_id` text,
	`tg_username` text,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`children` text NOT NULL,
	`from_text` text NOT NULL,
	`to_text` text NOT NULL,
	`schedule` text NOT NULL,
	`comment` text,
	`status` text DEFAULT 'new' NOT NULL,
	`note` text,
	`decided_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_external` ON `leads` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `leads_status` ON `leads` (`status`);