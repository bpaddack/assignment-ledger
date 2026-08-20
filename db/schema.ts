import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const assignments = sqliteTable("assignments", {
  id: text("id").primaryKey(),
  assignee: text("assignee").notNull(),
  assignment: text("assignment").notNull(),
  threadUrl: text("thread_url").notNull(),
  assignedAt: text("assigned_at").notNull(),
  dueDate: text("due_date"),
  completed: integer("completed").notNull().default(0),
  completedAt: text("completed_at"),
  archived: integer("archived").notNull().default(0),
  archivedAt: text("archived_at"),
  source: text("source").notNull().default("manual"),
  dedupeKey: text("dedupe_key"),
  createdAt: text("created_at").notNull(),
});

export const assignmentInsights = sqliteTable("assignment_insights", {
  assignmentId: text("assignment_id").primaryKey(),
  acknowledged: integer("acknowledged").notNull().default(0),
  acknowledgementType: text("acknowledgement_type"),
  acknowledgementDetail: text("acknowledgement_detail"),
  workStatus: text("work_status").notNull().default("not_started"),
  summary: text("summary").notNull().default("No acknowledgement or progress update yet."),
  updatesJson: text("updates_json").notNull().default("[]"),
  lastCheckedAt: text("last_checked_at"),
  updatedAt: text("updated_at").notNull(),
});

export const myTasks = sqliteTable("my_tasks", {
  id: text("id").primaryKey(),
  requester: text("requester").notNull(),
  requestType: text("request_type").notNull().default("task"),
  task: text("task").notNull(),
  threadUrl: text("thread_url").notNull(),
  askedAt: text("asked_at").notNull(),
  dueDate: text("due_date"),
  completed: integer("completed").notNull().default(0),
  completedAt: text("completed_at"),
  archived: integer("archived").notNull().default(0),
  archivedAt: text("archived_at"),
  source: text("source").notNull().default("manual"),
  dedupeKey: text("dedupe_key"),
  createdAt: text("created_at").notNull(),
});

export const myTaskInsights = sqliteTable("my_task_insights", {
  myTaskId: text("my_task_id").primaryKey(),
  acknowledged: integer("acknowledged").notNull().default(0),
  acknowledgementType: text("acknowledgement_type"),
  acknowledgementDetail: text("acknowledgement_detail"),
  workStatus: text("work_status").notNull().default("not_started"),
  summary: text("summary").notNull().default("No response or progress update from you yet."),
  updatesJson: text("updates_json").notNull().default("[]"),
  lastCheckedAt: text("last_checked_at"),
  updatedAt: text("updated_at").notNull(),
});

export const monitorState = sqliteTable("monitor_state", {
  monitorId: text("monitor_id").primaryKey(),
  lastSuccessfulTs: text("last_successful_ts").notNull(),
  lastSuccessfulAt: text("last_successful_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  settingKey: text("setting_key").primaryKey(),
  settingValue: text("setting_value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const monitorCursors = sqliteTable("monitor_cursors", {
  monitorId: text("monitor_id").notNull(),
  cursorKey: text("cursor_key").notNull(),
  lastSeenTs: text("last_seen_ts").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.monitorId, table.cursorKey] })]);

export const monitorCandidates = sqliteTable("monitor_candidates", {
  dedupeKey: text("dedupe_key").primaryKey(),
  ledger: text("ledger").notNull(),
  channelId: text("channel_id").notNull(),
  messageTs: text("message_ts").notNull(),
  authorId: text("author_id"),
  targetId: text("target_id"),
  text: text("text").notNull(),
  threadUrl: text("thread_url").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  detectedAt: text("detected_at").notNull(),
  processedAt: text("processed_at"),
}, (table) => [index("idx_monitor_candidates_pending").on(table.ledger, table.messageTs)]);

export const monitorRuns = sqliteTable("monitor_runs", {
  runId: text("run_id").primaryKey(),
  monitorId: text("monitor_id").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at").notNull(),
  ceilingTs: text("ceiling_ts").notNull(),
  conversationsChecked: integer("conversations_checked").notNull().default(0),
  messagesChecked: integer("messages_checked").notNull().default(0),
  capturedCount: integer("captured_count").notNull().default(0),
  candidateCount: integer("candidate_count").notNull().default(0),
  outcome: text("outcome").notNull(),
}, (table) => [index("idx_monitor_runs_monitor_finished").on(table.monitorId, table.finishedAt)]);
