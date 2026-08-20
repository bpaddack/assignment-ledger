ALTER TABLE `assignments` ADD `archived` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `assignments` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `my_tasks` ADD `archived` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `my_tasks` ADD `archived_at` text;