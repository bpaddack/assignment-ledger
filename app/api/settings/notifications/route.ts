import { env } from "cloudflare:workers";

const schema = `CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TEXT NOT NULL
)`;

async function ready() {
  await env.DB.prepare(schema).run();
  return env.DB;
}

export async function GET() {
  try {
    const db = await ready();
    const row = await db.prepare("SELECT setting_value AS value FROM app_settings WHERE setting_key = 'desktop_notifications_enabled'").first<{ value: string }>();
    return Response.json({ enabled: row?.value !== "false" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read notification settings" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { enabled } = await request.json() as { enabled?: unknown };
    if (typeof enabled !== "boolean") return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
    const db = await ready();
    await db.prepare(`INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES ('desktop_notifications_enabled', ?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`)
      .bind(String(enabled), new Date().toISOString()).run();
    return Response.json({ enabled });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update notification settings" }, { status: 500 });
  }
}
