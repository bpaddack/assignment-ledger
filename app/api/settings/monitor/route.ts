import { env } from "cloudflare:workers";

const schema = `CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_runs (
  run_id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL, started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL, ceiling_ts TEXT NOT NULL,
  conversations_checked INTEGER NOT NULL DEFAULT 0,
  messages_checked INTEGER NOT NULL DEFAULT 0,
  captured_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL
)`;

async function ready() {
  for (const statement of schema.split(";").map((value) => value.trim()).filter(Boolean)) await env.DB.prepare(statement).run();
  return env.DB;
}

async function state() {
  const db = await ready();
  const [setting, lastRun] = await Promise.all([
    db.prepare("SELECT setting_value AS value FROM app_settings WHERE setting_key='heartbeat_monitor_enabled'").first<{ value: string }>(),
    db.prepare("SELECT started_at AS startedAt,finished_at AS finishedAt,outcome,captured_count AS capturedCount,candidate_count AS candidateCount FROM monitor_runs WHERE monitor_id='slack_fast_lane' ORDER BY finished_at DESC LIMIT 1").first(),
  ]);
  return { enabled: setting?.value !== "false", lastRun: lastRun || null };
}

export async function GET() {
  try { return Response.json(await state()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not read monitor settings" }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const { enabled } = await request.json() as { enabled?: unknown };
    if (typeof enabled !== "boolean") return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
    const db = await ready();
    await db.prepare(`INSERT INTO app_settings (setting_key,setting_value,updated_at) VALUES ('heartbeat_monitor_enabled',?,?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at`)
      .bind(String(enabled), new Date().toISOString()).run();
    return Response.json({ ...(await state()), enabled });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update monitor settings" }, { status: 500 });
  }
}
