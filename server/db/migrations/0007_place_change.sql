PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_change_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`kind` text NOT NULL,
	`child_id` text,
	`place_id` text,
	`address` text,
	`lat` real,
	`lon` real,
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
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ride_id`) REFERENCES `rides`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_change_requests`("id", "family_id", "requested_by", "kind", "child_id", "place_id", "address", "lat", "lon", "ride_id", "date_from", "date_to", "time", "reason", "status", "answer", "decided_at", "created_at") SELECT "id", "family_id", "requested_by", "kind", "child_id", NULL, NULL, NULL, NULL, "ride_id", "date_from", "date_to", "time", "reason", "status", "answer", "decided_at", "created_at" FROM `change_requests`;--> statement-breakpoint
DROP TABLE `change_requests`;--> statement-breakpoint
ALTER TABLE `__new_change_requests` RENAME TO `change_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `changes_family` ON `change_requests` (`family_id`);--> statement-breakpoint
CREATE INDEX `changes_status` ON `change_requests` (`status`);