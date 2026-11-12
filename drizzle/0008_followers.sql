CREATE TABLE `follower_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`channel_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_error` text,
	`delivered_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `follower_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `follower_deliveries_event_channel_idx` ON `follower_deliveries` (`event_id`,`channel_id`);--> statement-breakpoint
CREATE INDEX `follower_deliveries_due_idx` ON `follower_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `follower_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` integer NOT NULL,
	`actor_login` text NOT NULL,
	`actor_avatar_url` text,
	`actor_url` text,
	`follower_count` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `follower_events_user_idx` ON `follower_events` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `followers` (
	`user_id` text NOT NULL,
	`github_user_id` integer NOT NULL,
	`login` text NOT NULL,
	`avatar_url` text,
	`followed_at` integer,
	PRIMARY KEY(`user_id`, `github_user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `channels` ADD `notify_follow` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `channels` ADD `notify_unfollow` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `followers_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `follower_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `followers_imported_at` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `followers_checked_at` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `followers_error` text;