export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/;
// Pragmatic address check: one @, no whitespace/control chars, sane length. Real validation = delivering mail.
export const EMAIL_RE =
  /^[^\s@<>"'`\\,;:()[\]]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function str(
  v: unknown,
  field: string,
  o: { min?: number; max: number; trim?: boolean; optional?: boolean },
): string {
  if (v === undefined || v === null) {
    if (o.optional) return "";
    throw new HttpError(400, `${field} is required.`, field);
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be text.`, field);
  const s = o.trim === false ? v : v.trim();
  if (s.length > o.max) throw new HttpError(400, `${field} is too long (max ${o.max}).`, field);
  if ((o.min ?? 1) > s.length && !(o.optional && s.length === 0))
    throw new HttpError(400, `${field} is required.`, field);
  // Reject NUL and other C0 control characters (except tab/newline/CR for free text).
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s))
    throw new HttpError(400, `${field} contains invalid characters.`, field);
  return s;
}

export function int(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v))
    throw new HttpError(400, `${field} must be a whole number.`, field);
  return v;
}

export function slugify(input: string): string {
  const s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return s || "page";
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Optional one-line edit summary ("Typo fixed", "Section 3 rewritten"). */
export function editComment(v: unknown): string | null {
  const s = str(v, "Summary", { max: 200, optional: true });
  if (/[\r\n\t\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(s))
    throw new HttpError(400, "Summary contains invalid characters.", "comment");
  return s || null;
}
