ALTER TABLE `user_settings` ADD `timezone` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `time_format` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `time_style` text DEFAULT 'relative' NOT NULL;