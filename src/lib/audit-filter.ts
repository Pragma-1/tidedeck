import { CATEGORIES, type AuditFilter, type Category } from "./audit";

const num = (v: string | null, max = 1e12) => (v && /^\d{1,13}$/.test(v) && Number(v) <= max ? Number(v) : undefined);

/** Parses and whitelists security-log filters from a query string. Anything odd is simply ignored. */
export function parseAuditFilter(sp: URLSearchParams): AuditFilter {
  const cat = sp.get("category");
  return {
    q: (sp.get("q") ?? "").slice(0, 100) || undefined,
    category: cat && Object.prototype.hasOwnProperty.call(CATEGORIES, cat) ? (cat as Category) : undefined,
    userId: num(sp.get("user"), 1e9),
    from: num(sp.get("from")),
    to: num(sp.get("to")),
    before: num(sp.get("before")),
    limit: num(sp.get("limit"), 200),
  };
}
