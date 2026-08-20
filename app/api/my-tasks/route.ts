import { env } from "cloudflare:workers";

const REQUEST_TYPES = new Set(["task", "question", "input", "approval", "review"]);

async function ready() {
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS my_tasks (
      id TEXT PRIMARY KEY, requester TEXT NOT NULL, request_type TEXT NOT NULL DEFAULT 'task',
      task TEXT NOT NULL, thread_url TEXT NOT NULL, asked_at TEXT NOT NULL, due_date TEXT,
      completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT, archived INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT, source TEXT NOT NULL DEFAULT 'manual',
      dedupe_key TEXT, created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_my_tasks_completed_asked_at ON my_tasks(completed, asked_at DESC)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_my_tasks_dedupe_key ON my_tasks(dedupe_key) WHERE dedupe_key IS NOT NULL"),
    db.prepare(`CREATE TABLE IF NOT EXISTS my_task_insights (
      my_task_id TEXT PRIMARY KEY, acknowledged INTEGER NOT NULL DEFAULT 0, acknowledgement_type TEXT,
      acknowledgement_detail TEXT, work_status TEXT NOT NULL DEFAULT 'not_started',
      summary TEXT NOT NULL DEFAULT 'No response or progress update from you yet.',
      updates_json TEXT NOT NULL DEFAULT '[]', last_checked_at TEXT, updated_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_my_task_insights_work_status ON my_task_insights(work_status)"),
  ]);
  return db;
}

export async function GET() {
  try {
    const db = await ready();
    const result = await db.prepare(`SELECT t.id, t.requester, t.request_type AS requestType, t.task,
      t.thread_url AS threadUrl, t.asked_at AS askedAt, t.due_date AS dueDate, t.completed,
      t.completed_at AS completedAt, t.archived, t.archived_at AS archivedAt, t.source, t.created_at AS createdAt,
      COALESCE(i.acknowledged, 0) AS acknowledged,
      i.acknowledgement_type AS acknowledgementType, i.acknowledgement_detail AS acknowledgementDetail,
      COALESCE(i.work_status, 'not_started') AS workStatus,
      COALESCE(i.summary, 'No response or progress update from you yet.') AS insightSummary,
      COALESCE(i.updates_json, '[]') AS updatesJson, i.last_checked_at AS lastCheckedAt
      FROM my_tasks t LEFT JOIN my_task_insights i ON i.my_task_id = t.id
      ORDER BY t.asked_at DESC, t.created_at DESC`).all();
    return Response.json({ tasks: result.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read local tasks" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const requester = String(payload.requester || "").trim();
    const requestType = String(payload.requestType || "task").trim();
    const task = String(payload.task || "").trim();
    const threadUrl = String(payload.threadUrl || "").trim();
    const askedAt = String(payload.askedAt || new Date().toISOString()).trim();
    const dueDate = String(payload.dueDate || "").trim() || null;
    const source = payload.source === "monitor" ? "monitor" : "manual";
    const dedupeKey = String(payload.dedupeKey || "").trim() || null;
    if (!requester) return Response.json({ error: "Who made the request is required." }, { status: 400 });
    if (!REQUEST_TYPES.has(requestType)) return Response.json({ error: "Request type is invalid." }, { status: 400 });
    if (!task) return Response.json({ error: "The requested action or question is required." }, { status: 400 });
    try { new URL(threadUrl); } catch { return Response.json({ error: "A valid source thread URL is required." }, { status: 400 }); }
    if (Number.isNaN(new Date(askedAt).getTime())) return Response.json({ error: "Asked at must be a valid date." }, { status: 400 });

    const db = await ready();
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO my_tasks (id, requester, request_type, task, thread_url, asked_at, due_date,
      completed, source, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
      .bind(id, requester, requestType, task, threadUrl, askedAt, dueDate, source, dedupeKey, new Date().toISOString()).run();
    const row = await db.prepare(`SELECT id, requester, request_type AS requestType, task, thread_url AS threadUrl,
      asked_at AS askedAt, due_date AS dueDate, completed, completed_at AS completedAt, archived, archived_at AS archivedAt, source,
      created_at AS createdAt,
      0 AS acknowledged, 'not_started' AS workStatus, 'No response or progress update from you yet.' AS insightSummary,
      '[]' AS updatesJson, NULL AS lastCheckedAt FROM my_tasks WHERE id = ?`).bind(id).first();
    return Response.json({ task: row }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save local task";
    if (message.includes("UNIQUE constraint failed")) return Response.json({ skipped: true, reason: "Already captured" });
    return Response.json({ error: message }, { status: 500 });
  }
}
