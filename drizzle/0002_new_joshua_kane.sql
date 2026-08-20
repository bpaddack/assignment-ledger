CREATE TABLE `monitor_state` (
	`monitor_id` text PRIMARY KEY NOT NULL,
	`last_successful_ts` text NOT NULL,
	`last_successful_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `my_task_insights` (
	`my_task_id` text PRIMARY KEY NOT NULL,
	`acknowledged` integer DEFAULT 0 NOT NULL,
	`acknowledgement_type` text,
	`acknowledgement_detail` text,
	`work_status` text DEFAULT 'not_started' NOT NULL,
	`summary` text DEFAULT 'No response or progress update from you yet.' NOT NULL,
	`updates_json` text DEFAULT '[]' NOT NULL,
	`last_checked_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `my_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`requester` text NOT NULL,
	`request_type` text DEFAULT 'task' NOT NULL,
	`task` text NOT NULL,
	`thread_url` text NOT NULL,
	`asked_at` text NOT NULL,
	`due_date` text,
	`completed` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`dedupe_key` text,
	`created_at` text NOT NULL
);
