CREATE TABLE `change_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`kind` text NOT NULL,
	`child_id` text NOT NULL,
	`ride_id` text,
	`date_from` text NOT NULL,
	`date_to` text NOT NULL,
	`time` text,
	`reason` text,
	`status` text DEFAULT 'new' NOT NULL,
	`answer` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ride_id`) REFERENCES `rides`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `changes_family` ON `change_requests` (`family_id`);--> statement-breakpoint
CREATE INDEX `changes_status` ON `change_requests` (`status`);