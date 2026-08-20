import { env } from "cloudflare:workers";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const payload = await request.json() as { completed?: boolean; archived?: boolean };
    let result;
    if (typeof payload.archived === "boolean") {
      const archived = payload.archived;
      result = await env.DB.prepare(`UPDATE assignments SET archived = ?, archived_at = ?
        WHERE id = ? AND (? = 0 OR completed = 1)`)
        .bind(Number(archived), archived ? new Date().toISOString() : null, id, Number(archived)).run();
    } else {
      const completed = Boolean(payload.completed);
      result = await env.DB.prepare("UPDATE assignments SET completed = ?, completed_at = ? WHERE id = ? AND archived = 0")
        .bind(Number(completed), completed ? new Date().toISOString() : null, id).run();
    }
    if (!result.meta.changes) return Response.json({ error: "Assignment not found." }, { status: 404 });
    return Response.json({ updated: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update assignment" }, { status: 500 });
  }
}
