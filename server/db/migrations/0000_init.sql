CREATE TABLE `children` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text,
	`birth_date` text,
	`grade` text,
	`photo_url` text,
	`seat` text DEFAULT 'none' NOT NULL,
	`notes` text,
	`handover_to` text NOT NULL,
	`code_word` text,
	`lestart_student_id` text,
	`color` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `children_family` ON `children` (`family_id`);--> statement-breakpoint
CREATE TABLE `drivers` (
	`user_id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text,
	`tracker_token` text NOT NULL,
	`bio` text,
	`photo_url` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drivers_tracker_token_unique` ON `drivers` (`tracker_token`);--> statement-breakpoint
CREATE TABLE `families` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `family_members` (
	`family_id` text NOT NULL,
	`user_id` text NOT NULL,
	`relation` text NOT NULL,
	`is_owner` integer DEFAULT false NOT NULL,
	`can_edit` integer DEFAULT false NOT NULL,
	`notify` text NOT NULL,
	PRIMARY KEY(`family_id`, `user_id`),
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `members_user` ON `family_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_by` text,
	`expires_at` integer NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`max_uses` integer DEFAULT 5 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ride_id` text,
	`kind` text NOT NULL,
	`channel` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`entrance_note` text,
	`radius_m` integer DEFAULT 150 NOT NULL,
	`contact_phone` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`driver_id` text NOT NULL,
	`at` integer NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`speed` real,
	`heading` real,
	`accuracy` real,
	`battery` real,
	`source` text NOT NULL,
	FOREIGN KEY (`driver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `positions_driver_at` ON `positions` (`driver_id`,`at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`failures` integer DEFAULT 0 NOT NULL,
	`last_ok_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `ride_events` (
	`id` text PRIMARY KEY NOT NULL,
	`ride_id` text NOT NULL,
	`type` text NOT NULL,
	`at` integer NOT NULL,
	`actor_user_id` text,
	`source` text NOT NULL,
	`lat` real,
	`lon` real,
	`meta` text,
	FOREIGN KEY (`ride_id`) REFERENCES `rides`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_ride` ON `ride_events` (`ride_id`,`at`);--> statement-breakpoint
CREATE TABLE `ride_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`child_id` text NOT NULL,
	`from_place_id` text NOT NULL,
	`to_place_id` text NOT NULL,
	`time` text NOT NULL,
	`arrive_by` text,
	`rule` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`escort` text DEFAULT 'to_door' NOT NULL,
	`price_rub` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `templates_family` ON `ride_templates` (`family_id`);--> statement-breakpoint
CREATE TABLE `rides` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`child_id` text NOT NULL,
	`template_id` text,
	`date` text NOT NULL,
	`from_place_id` text NOT NULL,
	`to_place_id` text NOT NULL,
	`pickup_time` text NOT NULL,
	`arrive_by` text,
	`escort` text DEFAULT 'to_door' NOT NULL,
	`price_rub` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`run_id` text,
	`pickup_stop_id` text,
	`dropoff_stop_id` text,
	`receiver` text,
	`cancel_reason` text,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `ride_templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`from_place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`pickup_stop_id`) REFERENCES `stops`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`dropoff_stop_id`) REFERENCES `stops`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rides_template_date` ON `rides` (`template_id`,`date`);--> statement-breakpoint
CREATE INDEX `rides_date` ON `rides` (`date`);--> statement-breakpoint
CREATE INDEX `rides_family_date` ON `rides` (`family_id`,`date`);--> statement-breakpoint
CREATE INDEX `rides_run` ON `rides` (`run_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`driver_id` text NOT NULL,
	`vehicle_id` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`driver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `runs_date` ON `runs` (`date`,`driver_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `stops` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`place_id` text NOT NULL,
	`kind` text NOT NULL,
	`planned_at` text NOT NULL,
	`departed_at` integer,
	`arrived_at` integer,
	`done_at` integer,
	`eta_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stops_run` ON `stops` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `template_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`date` text NOT NULL,
	`action` text NOT NULL,
	`time` text,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `ride_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exceptions_template_date` ON `template_exceptions` (`template_id`,`date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`roles` text NOT NULL,
	`yandex_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_yandex_id_unique` ON `users` (`yandex_id`);--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`plate` text NOT NULL,
	`seats` integer NOT NULL,
	`boosters` integer DEFAULT 0 NOT NULL,
	`child_seats` integer DEFAULT 0 NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
