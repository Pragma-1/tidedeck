import { one, sql } from "@/lib/db";
export const dynamic = "force-dynamic";
// Liveness for Docker: the app answers and the database is reachable.
export async function GET() {
  try {
    await one(sql`SELECT 1`);
    return new Response("ok", { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response("db error", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
