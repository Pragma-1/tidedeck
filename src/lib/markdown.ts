import MarkdownIt, { type MarkdownIt as MD, type Token, type StateInline } from "markdown-it";
import anchor from "markdown-it-anchor";
import container from "markdown-it-container";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import deflist from "markdown-it-deflist";
import abbr from "markdown-it-abbr";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import mark from "markdown-it-mark";
import ins from "markdown-it-ins";
import { full as emoji } from "markdown-it-emoji";
import hljs from "highlight.js/lib/common";
import sanitizeHtml from "sanitize-html";
import { createHash } from "node:crypto";
import { slugify } from "./validate";
import { classify, isLocal, safeUrl } from "./embed-url";
import { BASE_URL } from "./config";
import { translate, type Lang } from "./i18n";
import { msg } from "./msg";

export type TocItem = { level: number; text: string; id: string };

const headingSlug = (s: string) =>
  "h-" +
  (s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section");

function wikiLinks(md: MD) {
  // [[Page title]] or [[Page title|link text]] -> /w/page-title
  md.inline.ruler.before("link", "wikilink", (state: StateInline, silent: boolean) => {
    const { src, pos } = state;
    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
    const end = src.indexOf("]]", pos + 2);
    if (end < 0) return false;
    const inner = src.slice(pos + 2, end);
    if (!inner || inner.length > 160 || /[\n[\]]/.test(inner)) return false;
    const bar = inner.indexOf("|");
    const target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
    const label = (bar < 0 ? inner : inner.slice(bar + 1)).trim();
    if (!target || !label) return false;
    if (!silent) {
      const open = state.push("link_open", "a", 1);
      open.attrs = [
        ["href", `/w/${slugify(target)}`],
        ["class", "wikilink"],
      ];
      state.push("text", "", 0).content = label;
      state.push("link_close", "a", -1);
    }
    state.pos = end + 2;
    return true;
  });
}

type Env = { lang: Lang; autoloadExternal: boolean; privacyHref: string | null };
const DEFAULT_ENV: Env = { lang: "en", autoloadExternal: false, privacyHref: "/privacy" };
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const PROVIDER = { youtube: "YouTube", vimeo: "Vimeo" } as const;

/** HTML for a media reference; every URL in here has passed safeUrl/classify. */
function mediaHtml(raw: string, title: string, env: Env, asImage: boolean): string | null {
  const t = (x: string, p?: Record<string, string>) => translate(env.lang, x, p);
  const e = classify(raw);
  const cap = title ? `<figcaption>${esc(title)}</figcaption>` : "";
  if (e?.kind === "video") {
    return (
      `<figure class="media-video"><video src="${esc(e.src)}" controls preload="none" playsinline></video>` +
      `<div class="media-tools"><button type="button" class="pip-btn">${esc(t(msg("Picture-in-picture")))}</button></div>${cap}</figure>`
    );
  }
  if (e?.kind === "youtube" || e?.kind === "vimeo") {
    const name = PROVIDER[e.kind];
    return (
      `<div class="embed embed-${e.kind}" data-embed="${e.kind}" data-id="${esc(e.id)}"><div class="embed-inner">` +
      `<p class="embed-title">${esc(title || t(msg("Video on {provider}"), { provider: name }))}</p>` +
      `<p class="embed-note">${esc(t(msg("Playing this video loads it from {provider}, which receives your IP address and may set cookies."), { provider: name }))}${env.privacyHref ? ` <a href="${esc(env.privacyHref)}">${esc(t(msg("Privacy notice")))}</a>` : ""}</p>` +
      `<p><button type="button" class="embed-load">${esc(t(msg("Load video")))}</button> <a class="embed-open" href="${esc(e.href)}">${esc(t(msg("Open on {provider}"), { provider: name }))}</a></p></div></div>`
    );
  }
  if (asImage) {
    const u = safeUrl(raw.trim());
    if (!u) return null;
    if (isLocal(u) || env.autoloadExternal) return null; // normal <img>
    return (
      `<div class="embed embed-image" data-embed="image" data-src="${esc(u.href)}" data-alt="${esc(title)}"><div class="embed-inner">` +
      `<p class="embed-title">${esc(title || t(msg("External image")))}</p>` +
      `<p class="embed-note">${esc(t(msg("This image is hosted on {host}. Loading it sends your IP address to that server."), { host: u.hostname }))}</p>` +
      `<p><button type="button" class="embed-load">${esc(t(msg("Load image")))}</button></p></div></div>`
    );
  }
  if (e?.kind === "link") {
    return `<a class="video-link" href="${esc(e.href)}"><span class="vl-icon" aria-hidden="true">▶</span><span class="vl-text"><strong>${esc(title || t(msg("Watch video")))}</strong><span class="vl-host">${esc(t(msg("Opens on {host}"), { host: e.host }))}</span></span></a>`;
  }
  return null;
}

function media(md: MD) {
  // @[title](url): video player, two-click provider embed, or link card
  md.inline.ruler.before("link", "media_embed", (state: StateInline, silent: boolean) => {
    const { src, pos } = state;
    if (src.charCodeAt(pos) !== 0x40 /* @ */ || src.charCodeAt(pos + 1) !== 0x5b /* [ */) return false;
    const close = src.indexOf("](", pos + 2);
    if (close < 0) return false;
    const title = src.slice(pos + 2, close);
    const end = src.indexOf(")", close + 2);
    if (end < 0 || title.length > 200 || /[\n[\]]/.test(title)) return false;
    const url = src.slice(close + 2, end).trim();
    if (!url || url.length > 2000 || /\s/.test(url) || !classify(url)) return false;
    if (!silent) {
      const tok = state.push("media_embed", "", 0);
      tok.meta = { url, title: title.trim() };
    }
    state.pos = end + 1;
    return true;
  });
  md.renderer.rules.media_embed = (tokens, idx, _o, envRaw) => {
    const env = envRaw as Env | undefined;
    const { url, title } = tokens[idx].meta as { url: string; title: string };
    return mediaHtml(url, title, env ?? DEFAULT_ENV, false) ?? "";
  };
  // A paragraph that holds nothing but one embed would wrap a block element in <p>; drop the wrapper.
  md.core.ruler.push("media_unwrap", (state) => {
    const t = state.tokens;
    for (let i = 0; i + 2 < t.length; i++) {
      const kids = t[i + 1].children ?? [];
      if (
        t[i].type === "paragraph_open" &&
        t[i + 1].type === "inline" &&
        t[i + 2].type === "paragraph_close" &&
        kids.length === 1 &&
        (kids[0].type === "media_embed" ||
          (kids[0].type === "image" && classify(String(kids[0].attrGet("src") ?? "")) !== null))
      ) {
        t[i].hidden = true;
        t[i + 2].hidden = true;
      }
    }
  });
  // ![alt](video.mp4 | youtube link | external image) get the same treatment
  const image = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, o, envRaw, self) => {
    const env = (envRaw as Env | undefined) ?? DEFAULT_ENV;
    const tok = tokens[idx];
    const src = String(tok.attrGet("src") ?? "");
    const alt = tok.children ? md.renderer.renderInlineAsText(tok.children, o, env) : tok.content;
    const e = classify(src);
    const html = e && e.kind !== "link" ? mediaHtml(src, alt, env, false) : mediaHtml(src, alt, env, true);
    return html ?? image(tokens, idx, o, envRaw, self);
  };
}

function build(): MD {
  const md: MD = new MarkdownIt({
    html: false, // raw HTML is never accepted — the single most important XSS control
    linkify: true,
    typographer: true,
    breaks: false,
    maxNesting: 40,
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre><code class="hljs language-${
            hljs
              .getLanguage(lang)!
              .name?.toLowerCase()
              .replace(/[^a-z0-9]/g, "") || "text"
          }">${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
        } catch {
          /* fall through to plain escaping */
        }
      }
      return "";
    },
  });
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });
  md.use(anchor, {
    slugify: headingSlug,
    level: [1, 2, 3, 4],
    permalink: anchor.permalink.ariaHidden({ placement: "after", class: "anchor", symbol: "#" }),
  })
    .use(footnote)
    .use(taskLists, { enabled: false, label: false })
    .use(deflist)
    .use(abbr)
    .use(sub)
    .use(sup)
    .use(mark)
    .use(ins)
    .use(emoji)
    .use(wikiLinks)
    .use(media);

  for (const kind of ["info", "tip", "warning", "danger"]) {
    md.use(container, kind, {
      render(tokens: Token[], idx: number) {
        if (tokens[idx].nesting !== 1) return "</div>\n";
        const title = tokens[idx].info.trim().slice(kind.length).trim();
        return `<div class="callout callout-${kind}">${title ? `<p class="callout-title">${md.utils.escapeHtml(title)}</p>` : ""}\n`;
      },
    });
  }
  // Code blocks get a copy button (rendered here, so it survives live refreshes; clicks handled in embeds.tsx).
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, o, envRaw, self) => {
    const env = (envRaw as Env | undefined) ?? DEFAULT_ENV;
    const label = esc(translate(env.lang, msg("Copy code")));
    return fence(tokens, idx, o, envRaw, self).replace(
      /^<pre>/,
      `<pre><button type="button" class="copy-code" aria-label="${label}" title="${label}">${label}</button>`,
    );
  };
  md.use(container, "details", {
    render(tokens: Token[], idx: number) {
      if (tokens[idx].nesting !== 1) return "</details>\n";
      const title = tokens[idx].info.trim().slice("details".length).trim() || "Details";
      return `<details><summary>${md.utils.escapeHtml(title)}</summary>\n`;
    },
  });
  return md;
}

const ID_RE = /^(?:h-[\p{L}\p{N}_-]{1,100}|fn(?:ref)?\d{1,4}(?::\d{1,4})?)$/u;
const guardId = (tagName: string, attribs: Record<string, string>) => {
  if (attribs.id !== undefined && !ID_RE.test(attribs.id)) delete attribs.id;
  return { tagName, attribs };
};

const OWN_ORIGIN = (() => {
  try {
    return new URL(BASE_URL).origin;
  } catch {
    return "";
  }
})();
/** Absolute http(s) link to another origin. Relative links, anchors and mailto: stay in the same tab. */
function isExternal(href: string | undefined): boolean {
  if (!href || !/^https?:\/\//i.test(href)) return false;
  try {
    return new URL(href).origin !== OWN_ORIGIN;
  } catch {
    return false;
  }
}

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "br",
    "hr",
    "strong",
    "em",
    "del",
    "s",
    "ins",
    "mark",
    "sub",
    "sup",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "dl",
    "dt",
    "dd",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "a",
    "img",
    "input",
    "abbr",
    "section",
    "div",
    "span",
    "details",
    "summary",
    "figure",
    "figcaption",
    "video",
    "button",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel", "class", "id", "aria-hidden", "target"],
    img: ["src", "alt", "title", "loading", "decoding", "referrerpolicy", "width", "height"],
    input: ["type", "checked", "disabled", "class"],
    abbr: ["title"],
    th: ["style", "colspan", "rowspan"],
    td: ["style", "colspan", "rowspan"],
    h1: ["id"],
    h2: ["id"],
    h3: ["id"],
    h4: ["id"],
    h5: ["id"],
    h6: ["id"],
    li: ["id", "class"],
    ul: ["class"],
    ol: ["class", "start"],
    sup: ["class"],
    section: ["class"],
    hr: ["class"],
    code: ["class"],
    span: ["class", "aria-hidden"],
    pre: ["class"],
    p: ["class"],
    div: ["class", "data-embed", "data-id", "data-src", "data-alt"],
    figure: ["class"],
    video: ["src", "controls", "preload", "playsinline"],
    button: ["type", "class", "aria-label", "title"],
  },
  allowedClasses: {
    a: ["wikilink", "anchor", "footnote-backref", "video-link", "embed-open", "ext"],
    code: ["hljs", "language-*"],
    pre: [],
    span: ["hljs-*", "vl-icon", "vl-text", "vl-host"],
    div: [
      "callout",
      "callout-info",
      "callout-tip",
      "callout-warning",
      "callout-danger",
      "embed",
      "embed-inner",
      "embed-youtube",
      "embed-vimeo",
      "embed-image",
      "media-tools",
    ],
    p: ["callout-title", "embed-title", "embed-note"],
    figure: ["media-video"],
    button: ["embed-load", "copy-code", "pip-btn"],
    li: ["task-list-item", "footnote-item"],
    ul: ["contains-task-list", "footnotes-list"],
    ol: ["footnotes-list"],
    sup: ["footnote-ref"],
    section: ["footnotes"],
    hr: ["footnotes-sep"],
    input: ["task-list-item-checkbox"],
  },
  allowedStyles: {
    th: { "text-align": [/^(?:left|right|center)$/] },
    td: { "text-align": [/^(?:left|right|center)$/] },
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"], video: ["https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (t, a) => {
      const g = guardId(t, a);
      g.attribs.rel = "noopener noreferrer nofollow ugc";
      // Links to other sites open in a new tab (rel=noopener above keeps the opener out of reach of the new page).
      if (isExternal(g.attribs.href)) {
        g.attribs.target = "_blank";
        g.attribs.class = [g.attribs.class, "ext"].filter(Boolean).join(" ");
      } else delete g.attribs.target;
      return g;
    },
    img: (t, a) => ({
      tagName: t,
      attribs: { ...a, loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" },
    }),
    input: (t, a) => ({ tagName: t, attribs: { ...a, type: "checkbox", disabled: "disabled" } }),
    // never autoplay, never fetch before the reader presses play
    video: (t, a) => ({ tagName: t, attribs: { src: a.src ?? "", controls: "", preload: "none", playsinline: "" } }),
    button: (t, a) => ({
      tagName: t,
      attribs: {
        type: "button",
        class: a.class === "embed-load" || a.class === "copy-code" || a.class === "pip-btn" ? a.class : "",
        ...(a.class === "copy-code" ? { "aria-label": a["aria-label"] ?? "", title: a.title ?? "" } : {}),
      },
    }),
    h1: guardId,
    h2: guardId,
    h3: guardId,
    h4: guardId,
    h5: guardId,
    h6: guardId,
    li: guardId,
  },
};

const md = build();
const cache = new Map<string, { html: string; toc: TocItem[] }>();
const sizes = new Map<string, number>();
const CACHE_MAX_BYTES = 24 * 1024 * 1024;
let cacheBytes = 0;

export type RenderOptions = { lang?: Lang; autoloadExternal?: boolean; privacyHref?: string | null };

export function renderMarkdown(src: string, opts: RenderOptions = {}): { html: string; toc: TocItem[] } {
  const env: Env = {
    lang: opts.lang ?? "en",
    autoloadExternal: !!opts.autoloadExternal,
    privacyHref: opts.privacyHref === undefined ? "/privacy" : opts.privacyHref,
  };
  const key = createHash("sha256")
    .update(`${env.lang}|${env.autoloadExternal ? 1 : 0}|${env.privacyHref ?? ""}|`)
    .update(src)
    .digest("hex");
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const tokens = md.parse(src, env);
  const toc: TocItem[] = [];
  tokens.forEach((t: Token, i: number) => {
    if (t.type !== "heading_open") return;
    const level = Number(t.tag.slice(1));
    const rawId = t.attrGet("id");
    const id = typeof rawId === "string" ? rawId : null;
    if (!id || level > 4) return;
    const text = (tokens[i + 1].children ?? [])
      .filter((c: Token) => c.type === "text" || c.type === "code_inline")
      .map((c: Token) => c.content)
      .join("")
      .trim();
    if (text) toc.push({ level, text, id });
  });
  const html = sanitizeHtml(md.renderer.render(tokens, md.options, env), SANITIZE);
  const out = { html, toc };
  // LRU bounded by size, not just count: 200 huge pages must not pin ~100 MB of RAM.
  const bytes = html.length * 2;
  if (bytes < CACHE_MAX_BYTES / 4) {
    cache.set(key, out);
    cacheBytes += bytes;
    sizes.set(key, bytes);
    while (cache.size > 300 || cacheBytes > CACHE_MAX_BYTES) {
      const old = cache.keys().next().value as string;
      cache.delete(old);
      cacheBytes -= sizes.get(old) ?? 0;
      sizes.delete(old);
    }
  }
  return out;
}
