PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_monitor_cursors` (
	`monitor_id` text NOT NULL,
	`cursor_key` text NOT NULL,
	`last_seen_ts` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`monitor_id`, `cursor_key`)
);
--> statement-breakpoint
INSERT INTO `__new_monitor_cursors`("monitor_id", "cursor_key", "last_seen_ts", "updated_at") SELECT "monitor_id", "cursor_key", "last_seen_ts", "updated_at" FROM `monitor_cursors`;--> statement-breakpoint
DROP TABLE `monitor_cursors`;--> statement-breakpoint
ALTER TABLE `__new_monitor_cursors` RENAME TO `monitor_cursors`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_monitor_candidates_pending` ON `monitor_candidates` (`ledger`,`message_ts`);--> statement-breakpoint
CREATE INDEX `idx_monitor_runs_monitor_finished` ON `monitor_runs` (`monitor_id`,`finished_at`);