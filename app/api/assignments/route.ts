import { env } from "cloudflare:workers";
import trackerConfig from "../../../config/tracker.json";

const DIRECT_REPORTS = new Set(trackerConfig.assignees.map((person) => person.name));

async function ready() {
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      assignee TEXT NOT NULL,
      assignment TEXT NOT NULL,
      thread_url TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      due_date TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      dedupe_key TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_assignments_completed_assigned_at ON assignments(completed, assigned_at DESC)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_dedupe_key ON assignments(dedupe_key) WHERE dedupe_key IS NOT NULL"),
    db.prepare(`CREATE TABLE IF NOT EXISTS assignment_insights (
      assignment_id TEXT PRIMARY KEY,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      acknowledgement_type TEXT,
      acknowledgement_detail TEXT,
      work_status TEXT NOT NULL DEFAULT 'not_started',
      summary TEXT NOT NULL DEFAULT 'No acknowledgement or progress update yet.',
      updates_json TEXT NOT NULL DEFAULT '[]',
      last_checked_at TEXT,
      updated_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_assignment_insights_work_status ON assignment_insights(work_status)"),
  ]);
  return db;
}

export async function GET() {
  try {
    const db = await ready();
    const result = await db.prepare(`SELECT a.id, a.assignee, a.assignment, a.thread_url AS threadUrl, a.assigned_at AS assignedAt,
      a.due_date AS dueDate, a.completed, a.completed_at AS completedAt, a.archived, a.archived_at AS archivedAt, a.source,
      COALESCE(i.acknowledged, 0) AS acknowledged, i.acknowledgement_type AS acknowledgementType,
      i.acknowledgement_detail AS acknowledgementDetail, COALESCE(i.work_status, 'not_started') AS workStatus,
      COALESCE(i.summary, 'No acknowledgement or progress update yet.') AS insightSummary,
      COALESCE(i.updates_json, '[]') AS updatesJson, i.last_checked_at AS lastCheckedAt
      FROM assignments a LEFT JOIN assignment_insights i ON i.assignment_id = a.id
      ORDER BY a.assigned_at DESC, a.created_at DESC`).all();
    return Response.json({ assignments: result.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read local assignments" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const assignee = String(payload.assignee || "").trim();
    const assignment = String(payload.assignment || "").trim();
    const threadUrl = String(payload.threadUrl || "").trim();
    const assignedAt = String(payload.assignedAt || new Date().toISOString()).trim();
    const dueDate = String(payload.dueDate || "").trim() || null;
    const source = payload.source === "monitor" ? "monitor" : "manual";
    const dedupeKey = String(payload.dedupeKey || "").trim() || null;
    if (!DIRECT_REPORTS.has(assignee)) return Response.json({ error: "That person is not on the direct-report capture list." }, { status: 400 });
    if (!assignment) return Response.json({ error: "What was assigned is required." }, { status: 400 });
    try { new URL(threadUrl); } catch { return Response.json({ error: "A valid source thread URL is required." }, { status: 400 }); }
    if (Number.isNaN(new Date(assignedAt).getTime())) return Response.json({ error: "Assigned at must be a valid date." }, { status: 400 });

    const db = await ready();
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO assignments (id, assignee, assignment, thread_url, assigned_at, due_date, completed, source, dedupe_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`).bind(id, assignee, assignment, threadUrl, assignedAt, dueDate, source, dedupeKey, new Date().toISOString()).run();
    const assignmentRow = await db.prepare(`SELECT id, assignee, assignment, thread_url AS threadUrl, assigned_at AS assignedAt,
      due_date AS dueDate, completed, completed_at AS completedAt, archived, archived_at AS archivedAt, source, 0 AS acknowledged,
      'not_started' AS workStatus, 'No acknowledgement or progress update yet.' AS insightSummary,
      '[]' AS updatesJson, NULL AS lastCheckedAt FROM assignments WHERE id = ?`).bind(id).first();
    return Response.json({ assignment: assignmentRow }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save local assignment";
    if (message.includes("UNIQUE constraint failed")) return Response.json({ skipped: true, reason: "Already captured" }, { status: 200 });
    return Response.json({ error: message }, { status: 500 });
  }
}
