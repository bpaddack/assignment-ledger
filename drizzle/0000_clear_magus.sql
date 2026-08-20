CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`assignee` text NOT NULL,
	`assignment` text NOT NULL,
	`thread_url` text NOT NULL,
	`assigned_at` text NOT NULL,
	`due_date` text,
	`completed` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`dedupe_key` text,
	`created_at` text NOT NULL
);
