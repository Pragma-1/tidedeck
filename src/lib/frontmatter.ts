/* Pure helpers, used on the server (import/export) and in the editor (open .md file). */

/** `---\ntitle: "…"\n---` — only `title` is read; no YAML parser is involved. */
export function parseFrontMatter(text: string): { title: string | null; body: string } {
  const t = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!t.startsWith("---\n")) return { title: null, body: t };
  const end = t.indexOf("\n---", 4);
  if (end < 0 || end > 8192) return { title: null, body: t };
  let title: string | null = null;
  for (const line of t.slice(4, end).split("\n")) {
    const m = /^title:\s*(.*)$/.exec(line);
    if (!m) continue;
    const v = m[1].trim();
    if (v.startsWith('"')) {
      try {
        const p = JSON.parse(v);
        if (typeof p === "string") title = p;
      } catch {
        /* ignore */
      }
    } else title = v.replace(/^'(.*)'$/, "$1");
  }
  const rest = t.slice(end + 4).replace(/^[^\n]*\n/, "");
  return { title: title?.trim() || null, body: rest.replace(/^\n+/, "") };
}

export const toMarkdownFile = (title: string, content: string) =>
  `---\ntitle: ${JSON.stringify(title)}\n---\n\n${content.replace(/\r\n?/g, "\n")}${content.endsWith("\n") ? "" : "\n"}`;
