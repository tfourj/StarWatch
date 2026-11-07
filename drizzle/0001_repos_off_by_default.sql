PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`github_token` text,
	`github_token_hint` text,
	`github_login` text,
	`github_scopes` text,
	`github_token_checked_at` integer,
	`polling_interval_minutes` integer DEFAULT 15 NOT NULL,
	`auto_monitor_new` integer DEFAULT false NOT NULL,
	`templates` text,
	`last_sync_at` integer,
	`last_sync_error` text,
	`last_poll_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_settings`("user_id", "github_token", "github_token_hint", "github_login", "github_scopes", "github_token_checked_at", "polling_interval_minutes", "auto_monitor_new", "templates", "last_sync_at", "last_sync_error", "last_poll_at", "created_at", "updated_at") SELECT "user_id", "github_token", "github_token_hint", "github_login", "github_scopes", "github_token_checked_at", "polling_interval_minutes", "auto_monitor_new", "templates", "last_sync_at", "last_sync_error", "last_poll_at", "created_at", "updated_at" FROM `user_settings`;--> statement-breakpoint
DROP TABLE `user_settings`;--> statement-breakpoint
ALTER TABLE `__new_user_settings` RENAME TO `user_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
UPDATE `user_settings` SET `auto_monitor_new` = 0;
