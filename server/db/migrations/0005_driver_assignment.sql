ALTER TABLE `ride_templates` ADD `driver_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `rides` ADD `driver_id` text REFERENCES users(id);