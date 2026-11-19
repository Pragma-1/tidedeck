"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bold,
  Code2,
  FileCode2,
  FileUp,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Lightbulb,
  Quote,
  Save,
  Table2,
  Strikethrough,
  Film,
} from "lucide-react";
import { call } from "@/lib/client-api";
import { Notice } from "./ui";
import { useConfirm } from "./confirm";
import { useDate, useT } from "./i18n";
import { parseFrontMatter } from "@/lib/frontmatter";

type Draft = { title: string; content: string; parentId: number | null; baseRev: number; savedAt: number };
/** Browser storage can be missing or throw (private mode, quota); drafts are a convenience, never required. */
const store = {
  get(k: string): Draft | null {
    try {
      const v = JSON.parse(localStorage.getItem(k) ?? "null");
      return v && typeof v.content === "string" && typeof v.title === "string" ? v : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: Draft) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* full or blocked */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

type Parent = { id: number; title: string; depth: number };
type Props = {
  mode: "new" | "edit";
  slug?: string;
  initial: { title: string; content: string; parentId: number | null; rev: number };
  parents: Parent[];
  importMode?: boolean;
};

export function Editor({ mode, slug, initial, parents, importMode = false }: Props) {
  const t = useT();
  const [confirmDialog, confirm] = useConfirm();
  const [importing, setImporting] = useState(importMode);
  const [dropping, setDropping] = useState(false);
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [parentId, setParentId] = useState<number | null>(initial.parentId);
  const [comment, setComment] = useState("");
  const [html, setHtml] = useState("");
  const [pane, setPane] = useState<"write" | "preview">("write");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const mdInput = useRef<HTMLInputElement>(null);
  const date = useDate();
  const draftKey = `tidewiki:draft:${slug ?? "new"}`;
  const [offer, setOffer] = useState<Draft | null>(null);
  const dirty = title !== initial.title || content !== initial.content || parentId !== initial.parentId;
  const saved = useRef(false);

  // Live preview: debounced, rendered and sanitised on the server with the same pipeline as published pages.
  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(
      () =>
        void (async () => {
          try {
            const res = await fetch("/api/render", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content }),
              signal: ctl.signal,
            });
            if (res.ok) setHtml((await res.json()).html ?? "");
          } catch {
            /* aborted or offline */
          }
        })(),
      280,
    );
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [content]);

  // Drafts: offer a locally saved version on open, autosave while typing, forget it after saving.
  useEffect(() => {
    const d = store.get(draftKey);
    if (d && (d.content !== initial.content || d.title !== initial.title)) setOffer(d);
    else if (d) store.del(draftKey);
  }, [draftKey, initial.content, initial.title]);
  useEffect(() => {
    if (!dirty || saved.current || offer) return;
    const h = setTimeout(
      () =>
        store.set(draftKey, { title, content, parentId, baseRev: initial.rev, savedAt: Math.floor(Date.now() / 1000) }),
      800,
    );
    return () => clearTimeout(h);
  }, [title, content, parentId, dirty, draftKey, initial.rev, offer]);

  const openMarkdown = async (f: File) => {
    if (f.size > 512 * 1024) {
      setError(t("This page is too large."));
      return;
    }
    const text = await f.text();
    if (text.includes("\u0000")) {
      setError(t("This isn’t a text file."));
      return;
    }
    const fm = parseFrontMatter(text);
    if (
      content.trim() &&
      !(await confirm({
        title: t("Replace the text?"),
        body: t("Replace the current text with the content of {name}?", { name: f.name }),
        confirmLabel: t("Replace"),
      }))
    )
      return;
    const heading = /^#\s+(.+)$/m.exec(fm.body)?.[1];
    const newTitle = (fm.title ?? heading ?? f.name.replace(/\.(md|markdown|txt)$/i, "")).trim().slice(0, 120);
    // A leading "# Title" that only repeats the page title is dropped, the page shows its title anyway.
    const body =
      heading && newTitle === heading.trim() && /^\s*#\s+[^\n]+\n?/.test(fm.body)
        ? fm.body.replace(/^\s*#\s+[^\n]+\n+/, "")
        : fm.body;
    setContent(body);
    if (!title.trim() || importing) setTitle(newTitle);
    setImporting(false);
  };

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty && !saved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const edit = (fn: (sel: string, before: string, after: string) => { text: string; select?: [number, number] }) => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const r = fn(content.slice(s, e), content.slice(0, s), content.slice(e));
    const next = content.slice(0, s) + r.text + content.slice(e);
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      const [a, b] = r.select ?? [s + r.text.length, s + r.text.length];
      el.setSelectionRange(s + a, s + b);
    });
  };
  const wrap = (l: string, r = l, ph = t("text")) =>
    edit((sel) => ({ text: l + (sel || ph) + r, select: [l.length, l.length + (sel || ph).length] }));
  const prefix = (p: string, ph = t("Item")) =>
    edit((sel, before) => {
      const nl = before.length === 0 || before.endsWith("\n") ? "" : "\n";
      const body = (sel || ph)
        .split("\n")
        .map((ln) => p + ln)
        .join("\n");
      return { text: nl + body, select: [nl.length, nl.length + body.length] };
    });
  const block = (text: string) =>
    edit((_s, before) => ({
      text: (before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n") + text + "\n",
    }));

  // Uploads: the file goes up as the raw request body; the server decides the type from its bytes.
  const upload = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      setUploading(f.name);
      setError(null);
      try {
        const res = await fetch(`/api/media?name=${encodeURIComponent(f.name.slice(0, 120))}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/octet-stream" },
          body: f,
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(t(d.error ?? "Upload failed."));
          break;
        }
        const label =
          (d.name ?? "").replace(/\.[^.]+$/, "").replace(/[[\]]/g, "") ||
          (d.kind === "video" ? t("Video") : t("Image"));
        block(d.kind === "video" ? `@[${label}](${d.url})` : `![${label}](${d.url})`);
      } catch {
        setError(t("Can’t reach the server. Check your connection."));
        break;
      }
    }
    setUploading(null);
  };
  const insertVideoLink = () => {
    const url = (videoUrl ?? "").trim();
    if (!/^https?:\/\/\S+$/.test(url)) {
      setError(t("Enter a full link starting with https://"));
      return;
    }
    block(`@[${t("Video")}](${url})`);
    setVideoUrl(null);
  };

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    const body = { title, content, parentId, comment: comment.trim() || undefined };
    const r =
      mode === "new"
        ? await call<{ slug: string }>("/api/pages", "POST", body)
        : await call<{ slug: string }>(`/api/pages/${slug}`, "PUT", { ...body, expectedRev: initial.rev });
    setBusy(false);
    if (!r.ok) {
      setError(t(r.data.error ?? "Couldn’t save."));
      return;
    }
    saved.current = true;
    store.del(draftKey);
    router.push(`/w/${r.data.slug}`);
    router.refresh();
  }, [title, content, parentId, comment, mode, slug, initial.rev, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const tools: ([string, typeof Bold, () => void] | "sep")[] = [
    [t("Bold"), Bold, () => wrap("**")],
    [t("Italic"), Italic, () => wrap("*")],
    [t("Strikethrough"), Strikethrough, () => wrap("~~")],
    "sep",
    [t("Heading"), Heading2, () => prefix("## ", t("Heading"))],
    [t("Quote"), Quote, () => prefix("> ", t("Quote"))],
    "sep",
    [t("Bulleted list"), List, () => prefix("- ")],
    [t("Numbered list"), ListOrdered, () => prefix("1. ")],
    [t("Task list"), ListChecks, () => prefix("- [ ] ", t("Task"))],
    "sep",
    [t("Inline code"), Code2, () => wrap("`", "`", "code")],
    [t("Code block"), FileCode2, () => block("```js\ncode\n```")],
    [
      t("Link"),
      Link2,
      () =>
        edit((sel) => {
          const txt = sel || t("text");
          return { text: `[${txt}](https://)`, select: [txt.length + 3, txt.length + 11] };
        }),
    ],
    [
      t("Table"),
      Table2,
      () => block(`| ${t("Column")} | ${t("Column")} |\n|--------|--------|\n| ${t("Cell")} | ${t("Cell")} |`),
    ],
    [t("Callout"), Lightbulb, () => block(`::: tip ${t("Title")}\n${t("Text")}\n:::`)],
    "sep",
    [t("Upload image or video"), ImagePlus, () => fileInput.current?.click()],
    [t("Embed a video link (YouTube, Vimeo, …)"), Film, () => setVideoUrl("")],
    [t("Open a Markdown file"), FileUp, () => mdInput.current?.click()],
  ];

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{mode === "new" ? t("New page") : t("Edit page")}</h1>
      {confirmDialog}
      {error && <Notice kind="error">{error}</Notice>}
      {mode === "new" && importing && (
        <div
          className={`import-drop${dropping ? " over" : ""}`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDropping(true);
            }
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            const f = e.dataTransfer.files[0];
            if (f) void openMarkdown(f);
          }}
        >
          <FileUp size={28} aria-hidden />
          <div>
            <strong>{t("Import a Markdown file")}</strong>
            <p className="hint">
              {t(
                "Choose or drop a .md file. Its title (front matter or first heading) and text are filled in below; nothing is saved until you press “Save page”.",
              )}
            </p>
          </div>
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={() => setImporting(false)}>
              {t("Start empty instead")}
            </button>
            <button type="button" className="btn sm" onClick={() => mdInput.current?.click()} autoFocus>
              <FileUp size={16} aria-hidden />
              {t("Choose file")}
            </button>
          </div>
        </div>
      )}
      {offer && (
        <div className="notice draft-offer">
          <div>
            {t("There is an unsaved draft from {date} in this browser.", { date: date(offer.savedAt) })}
            {offer.baseRev !== initial.rev && <> {t("It is based on an older version of the page.")}</>}
            <span className="row" style={{ marginTop: ".5rem" }}>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  store.del(draftKey);
                  setOffer(null);
                }}
              >
                {t("Discard")}
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setTitle(offer.title);
                  setContent(offer.content);
                  setParentId(offer.parentId);
                  setOffer(null);
                }}
              >
                {t("Restore draft")}
              </button>
            </span>
          </div>
        </div>
      )}
      <div className="editor-top">
        <div className="field">
          <label htmlFor="title">{t("Title")}</label>
          <input
            id="title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
            autoFocus={mode === "new" && !importing}
          />
        </div>
        <div className="field">
          <label htmlFor="parent">{t("Chapter")}</label>
          <select
            id="parent"
            className="input"
            value={parentId ?? ""}
            onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{t("Top level")}</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {" ".repeat(p.depth)}
                {p.title}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label={t("Editor view")}>
        <button
          type="button"
          role="tab"
          aria-selected={pane === "write"}
          className={`btn sm ${pane === "write" ? "" : "ghost"}`}
          onClick={() => setPane("write")}
        >
          {t("Write")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === "preview"}
          className={`btn sm ${pane === "preview" ? "" : "ghost"}`}
          onClick={() => setPane("preview")}
        >
          {t("Preview")}
        </button>
      </div>
      <div className="split">
        <div data-pane="write" data-hidden={pane !== "write"}>
          <div className="toolbar" role="toolbar" aria-label={t("Formatting")}>
            {tools.map((t, i) =>
              t === "sep" ? (
                <span className="sep" key={i} />
              ) : (
                <button type="button" key={t[0]} title={t[0]} aria-label={t[0]} onClick={t[2]}>
                  {(() => {
                    const I = t[1];
                    return <I size={17} aria-hidden />;
                  })()}
                </button>
              ),
            )}
          </div>
          <label className="sr-only" htmlFor="content">
            {t("Page content in Markdown")}
          </label>
          <input
            ref={mdInput}
            type="file"
            hidden
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openMarkdown(f);
              e.target.value = "";
            }}
          />
          <input
            ref={fileInput}
            type="file"
            hidden
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/ogg,video/quicktime"
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
          {videoUrl !== null && (
            <div className="inline-form">
              <label htmlFor="vurl">{t("Video link")}</label>
              <input
                id="vurl"
                className="input"
                type="url"
                placeholder="https://www.youtube.com/watch?v=…"
                value={videoUrl}
                autoFocus
                onChange={(e) => setVideoUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    insertVideoLink();
                  }
                  if (e.key === "Escape") setVideoUrl(null);
                }}
              />
              <button type="button" className="btn ghost sm" onClick={() => setVideoUrl(null)}>
                {t("Cancel")}
              </button>
              <button type="button" className="btn sm" onClick={insertVideoLink}>
                {t("Insert")}
              </button>
              <span className="hint">
                {t("YouTube and Vimeo are embedded with a click-to-load player; other links become a link card.")}
              </span>
            </div>
          )}
          {uploading && (
            <p className="hint upload-note" role="status">
              {t("Uploading {name}…", { name: uploading })}
            </p>
          )}
          <textarea
            id="content"
            ref={area}
            className="input"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck
            maxLength={500000}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                void upload(e.clipboardData.files);
              }
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              if (e.dataTransfer.files.length) {
                e.preventDefault();
                void upload(e.dataTransfer.files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                edit((sel) => ({
                  text: sel
                    ? sel
                        .split("\n")
                        .map((l) => "  " + l)
                        .join("\n")
                    : "  ",
                }));
              }
            }}
          />
        </div>
        <div data-pane="preview" data-hidden={pane !== "preview"}>
          <div
            className="preview md"
            aria-live="polite"
            dangerouslySetInnerHTML={{ __html: html || `<p><em>${t("Nothing to preview yet.")}</em></p>` }}
          />
        </div>
      </div>
      <div className="editor-bar">
        <span className="hint">{dirty ? t("Unsaved changes · Ctrl/⌘+S to save") : t("No changes yet")}</span>
        <div className="row editor-save">
          <input
            className="input edit-summary"
            value={comment}
            onChange={(e) => setComment(e.target.value.replace(/[\r\n\t]/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy && title.trim()) {
                e.preventDefault();
                void save();
              }
            }}
            maxLength={200}
            placeholder={t("What did you change? (optional)")}
            aria-label={t("Summary of the change")}
          />
          <button type="button" className="btn ghost" onClick={() => router.back()}>
            {t("Cancel")}
          </button>
          <button type="button" className="btn" disabled={busy || !title.trim()} onClick={() => void save()}>
            <Save size={16} aria-hidden />
            {busy ? t("Saving…") : t("Save page")}
          </button>
        </div>
      </div>
    </div>
  );
}
