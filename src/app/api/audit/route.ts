import { api, json } from "@/lib/api";
import { queryAudit } from "@/lib/audit";
import { parseAuditFilter } from "@/lib/audit-filter";
export const dynamic = "force-dynamic";

export const GET = api("admin", async ({ req }) => json(await queryAudit(parseAuditFilter(req.nextUrl.searchParams))));
