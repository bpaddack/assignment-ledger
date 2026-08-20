CREATE TABLE `app_settings` (
	`setting_key` text PRIMARY KEY NOT NULL,
	`setting_value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `monitor_candidates` (
	`dedupe_key` text PRIMARY KEY NOT NULL,
	`ledger` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_ts` text NOT NULL,
	`author_id` text,
	`target_id` text,
	`text` text NOT NULL,
	`thread_url` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`detected_at` text NOT NULL,
	`processed_at` text
);
--> statement-breakpoint
CREATE TABLE `monitor_cursors` (
	`monitor_id` text NOT NULL,
	`cursor_key` text NOT NULL,
	`last_seen_ts` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `monitor_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`monitor_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	`ceiling_ts` text NOT NULL,
	`conversations_checked` integer DEFAULT 0 NOT NULL,
	`messages_checked` integer DEFAULT 0 NOT NULL,
	`captured_count` integer DEFAULT 0 NOT NULL,
	`candidate_count` integer DEFAULT 0 NOT NULL,
	`outcome` text NOT NULL
);
