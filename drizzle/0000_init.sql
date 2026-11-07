CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`all_repos` integer DEFAULT true NOT NULL,
	`notify_star` integer DEFAULT true NOT NULL,
	`notify_unstar` integer DEFAULT true NOT NULL,
	`milestone_every` integer,
	`templates` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `channels_user_idx` ON `channels` (`user_id`);--> statement-breakpoint
CREATE TABLE `delivery_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`delivery_id` integer NOT NULL,
	`attempt` integer NOT NULL,
	`success` integer NOT NULL,
	`error` text,
	`duration_ms` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`delivery_id`) REFERENCES `notification_deliveries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempts_delivery_idx` ON `delivery_attempts` (`delivery_id`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
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
	FOREIGN KEY (`event_id`) REFERENCES `star_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliveries_event_channel_idx` ON `notification_deliveries` (`event_id`,`channel_id`);--> statement-breakpoint
CREATE INDEX `deliveries_due_idx` ON `notification_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`github_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`name` text NOT NULL,
	`owner` text NOT NULL,
	`html_url` text NOT NULL,
	`description` text,
	`private` integer DEFAULT false NOT NULL,
	`fork` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`star_count` integer DEFAULT 0 NOT NULL,
	`monitored` integer DEFAULT false NOT NULL,
	`mode` text DEFAULT 'webhook' NOT NULL,
	`all_channels` integer DEFAULT true NOT NULL,
	`hook_id` integer,
	`hook_status` text DEFAULT 'none' NOT NULL,
	`hook_error` text,
	`hook_checked_at` integer,
	`backfilled_at` integer,
	`backfill_error` text,
	`last_polled_at` integer,
	`removed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_user_github_idx` ON `repositories` (`user_id`,`github_id`);--> statement-breakpoint
CREATE INDEX `repositories_github_idx` ON `repositories` (`github_id`);--> statement-breakpoint
CREATE TABLE `repository_channels` (
	`repository_id` integer NOT NULL,
	`channel_id` integer NOT NULL,
	PRIMARY KEY(`repository_id`, `channel_id`),
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `star_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`repository_id` integer NOT NULL,
	`action` text NOT NULL,
	`actor_id` integer NOT NULL,
	`actor_login` text NOT NULL,
	`actor_avatar_url` text,
	`actor_url` text,
	`star_count` integer NOT NULL,
	`source` text NOT NULL,
	`delivery_id` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `star_events_user_idx` ON `star_events` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `star_events_repo_idx` ON `star_events` (`repository_id`);--> statement-breakpoint
CREATE TABLE `stargazers` (
	`repository_id` integer NOT NULL,
	`github_user_id` integer NOT NULL,
	`login` text NOT NULL,
	`avatar_url` text,
	`starred_at` integer,
	PRIMARY KEY(`repository_id`, `github_user_id`),
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stargazers_starred_idx` ON `stargazers` (`starred_at`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`github_token` text,
	`github_token_hint` text,
	`github_login` text,
	`github_scopes` text,
	`github_token_checked_at` integer,
	`polling_interval_minutes` integer DEFAULT 15 NOT NULL,
	`auto_monitor_new` integer DEFAULT true NOT NULL,
	`templates` text,
	`last_sync_at` integer,
	`last_sync_error` text,
	`last_poll_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`status` text NOT NULL,
	`repo_full_name` text,
	`received_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
