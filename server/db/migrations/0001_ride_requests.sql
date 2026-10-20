CREATE TABLE `ride_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`child_ids` text NOT NULL,
	`from_place_id` text,
	`from_address` text,
	`to_place_id` text,
	`to_address` text,
	`time` text NOT NULL,
	`rule` text NOT NULL,
	`start_date` text NOT NULL,
	`escort` text DEFAULT 'to_door' NOT NULL,
	`comment` text,
	`price_rub` integer NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`answer` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requests_family` ON `ride_requests` (`family_id`);--> statement-breakpoint
CREATE INDEX `requests_status` ON `ride_requests` (`status`);