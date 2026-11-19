/*
 * HTML e-mails in the wiki's look: same colours, same type (Inter, with the system UI font as the
 * fallback mail clients actually use — web fonts are not loaded from third parties, that would
 * report every opened mail to a font host). Tables + inline styles, because that is what mail
 * clients render reliably. Every dynamic value is HTML-escaped; links must be http(s).
 */

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const FONT = "Inter,'Segoe UI Variable','Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif";
const C = {
  bg: "#f2f2ef",
  band: "#2a2f36",
  bandInk: "#eceef1",
  sheet: "#ffffff",
  ink: "#1e2227",
  ink2: "#5c636d",
  line: "#e1e1dc",
  accent: "#3d5a80",
  accentSoft: "#e9eef5",
};

export type MailContent = {
  site: string;
  /** Inbox preview line (hidden in the body). */
  preheader?: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Shown under the button: the raw link, for clients that block buttons. */
  linkFallback?: string;
  /** Key/value lines in a light box, e.g. time and address of a change. */
  facts?: [string, string][];
  footer: string;
};

const safeHref = (u: string) => (/^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : "#");

export function renderMail(c: MailContent): { html: string; text: string } {
  const p = (s: string) =>
    `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.ink};">${esc(s)}</p>`;
  const facts = c.facts?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;background:${C.accentSoft};border-radius:8px;">` +
      c.facts
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px 14px;font-family:${FONT};font-size:13.5px;color:${C.ink2};white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:8px 14px 8px 0;font-family:${FONT};font-size:13.5px;color:${C.ink};word-break:break-word;">${esc(v)}</td></tr>`,
        )
        .join("") +
      `</table>`
    : "";
  // A button whose link isn't plain http(s) is dropped altogether (never rendered as a link or as text).
  const btn = c.button && safeHref(c.button.url) !== "#" ? c.button : undefined;
  const button = btn
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 18px;"><tr><td style="border-radius:8px;background:${C.accent};">` +
      `<a href="${esc(btn.url)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(btn.label)}</a>` +
      `</td></tr></table>` +
      (c.linkFallback
        ? `<p style="margin:0 0 14px;font-family:${FONT};font-size:12.5px;line-height:1.5;color:${C.ink2};">${esc(c.linkFallback)}<br><a href="${esc(btn.url)}" style="color:${C.accent};word-break:break-all;">${esc(btn.url)}</a></p>`
        : "")
    : "";
  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(c.heading)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
${c.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(c.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.sheet};border:1px solid ${C.line};border-radius:12px;overflow:hidden;">
<tr><td style="background:${C.band};padding:16px 26px;font-family:${FONT};font-size:16px;font-weight:700;letter-spacing:-.01em;color:${C.bandInk};">&#128214;&nbsp; ${esc(c.site)}</td></tr>
<tr><td style="padding:28px 26px 12px;">
<h1 style="margin:0 0 16px;font-family:${FONT};font-size:21px;line-height:1.3;font-weight:700;letter-spacing:-.01em;color:${C.ink};">${esc(c.heading)}</h1>
${c.paragraphs.map(p).join("\n")}
${facts}${button}
</td></tr>
<tr><td style="padding:14px 26px 18px;border-top:1px solid ${C.line};font-family:${FONT};font-size:12.5px;line-height:1.5;color:${C.ink2};">${esc(c.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    c.heading,
    "",
    ...c.paragraphs.flatMap((x) => [x, ""]),
    ...(c.facts ?? []).map(([k, v]) => `${k}: ${v}`),
    ...(c.facts?.length ? [""] : []),
    ...(btn ? [`${btn.label}:`, btn.url, ""] : []),
    "—",
    c.footer,
  ].join("\n");
  return { html, text };
}
