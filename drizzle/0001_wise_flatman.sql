CREATE TABLE `assignment_insights` (
	`assignment_id` text PRIMARY KEY NOT NULL,
	`acknowledged` integer DEFAULT 0 NOT NULL,
	`acknowledgement_type` text,
	`acknowledgement_detail` text,
	`work_status` text DEFAULT 'not_started' NOT NULL,
	`summary` text DEFAULT 'No acknowledgement or progress update yet.' NOT NULL,
	`updates_json` text DEFAULT '[]' NOT NULL,
	`last_checked_at` text,
	`updated_at` text NOT NULL
);
