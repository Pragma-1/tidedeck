import "./setup-env";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { zipSync, strToU8, unzipSync } from "fflate";
import * as auth from "@/lib/auth";
import { db } from "./pg";
import { createPage, getPage, getTree, backlinks, recentChanges, readingOrder, updatePage } from "@/lib/pages";
import { storeUpload } from "@/lib/media";
import {
  dropStaged,
  exportWikiZip,
  importArchive,
  IMPORT_LIMITS,
  parseFrontMatter,
  stagedUpload,
  stageUpload,
  toMarkdownFile,
} from "@/lib/transfer";
import { verifyPassword, hashPassword } from "@/lib/password";
import { queryAudit } from "@/lib/audit";

const PW = "tidal-marsh-lantern-47";
const dir = () => process.env.WIKI_DATA_DIR!;
const fx = (n: string) => readFileSync(path.join(import.meta.dirname, "fixtures", n));
const tmp = (name: string, data: Uint8Array | string) => {
  const p = path.join(dir(), name);
  writeFileSync(p, data);
  return p;
};
const zip = (files: Record<string, string | Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));
const toBuf = async (s: ReadableStream<Uint8Array>) => {
  const r = s.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    parts.push(value);
  }
  return Buffer.concat(parts);
};
const stream = (b: Buffer) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(b));
      c.close();
    },
  });
let uid = 0;

describe("front matter", () => {
  it("reads only the title, tolerates odd input", async () => {
    expect(parseFrontMatter('---\ntitle: "Hallo \\"Welt\\""\nauthor: x\n---\n\n# Body\n')).toEqual({
      title: 'Hallo "Welt"',
      body: "# Body\n",
    });
    expect(parseFrontMatter("---\ntitle: plain title\n---\ntext")).toEqual({ title: "plain title", body: "text" });
    expect(parseFrontMatter("﻿---\r\ntitle: 'x'\r\n---\r\nA")).toEqual({ title: "x", body: "A" });
    expect(parseFrontMatter("no front matter").title).toBeNull();
    expect(parseFrontMatter("---\ntitle: !!js/function 'evil'\n---\nx").title).toBe("!!js/function 'evil'"); // plain text, never evaluated
    expect(parseFrontMatter("---\n" + "a".repeat(10000) + "\n---\nx").title).toBeNull();
    const round = parseFrontMatter(toMarkdownFile('Ti"tle: with --- dashes', "body\r\nline"));
    expect(round).toEqual({ title: 'Ti"tle: with --- dashes', body: "body\nline\n" });
  });
});

describe("export → import round trip", () => {
  it("restores pages, hierarchy, links and media into an empty wiki", async () => {
    uid = await auth.setupAdmin((await auth.ensureSetupToken())!, "chef", "chef@example.com", PW, null);
    const m = await storeUpload(stream(fx("exif.jpg")), 0, "foto.jpg", uid);
    const ch = await createPage({ title: "Einsatz", content: "Kapitel.", parentId: null, userId: uid });
    await createPage({
      title: "Funk",
      content: `Siehe [[Einsatz]].\n\n![Foto](/media/${m.name})`,
      parentId: ch.id,
      userId: uid,
    });
    const zipBuf = await toBuf(exportWikiZip());
    const files = unzipSync(new Uint8Array(zipBuf));
    expect(Object.keys(files).sort()).toEqual(
      [
        "_media/" + m.name,
        "einsatz/funk.md",
        "einsatz/index.md",
        "markdown-guide.md",
        "tidewiki.json",
        "welcome.md",
      ].sort(),
    );
    expect(new TextDecoder().decode(files["einsatz/funk.md"])).toMatch(/^---\ntitle: "Funk"\n---\n/);

    // wipe content, keep the account
    await db().prepare("DELETE FROM pages").run();
    await db().prepare("DELETE FROM media").run();
    const r = await importArchive(tmp("rt.zip", zipBuf), { apply: true, conflict: "skip", userId: uid });
    expect(r.created).toBe(4);
    expect(r.warnings).toEqual([]);
    const funk = (await getPage("funk"))!;
    expect((await getPage("einsatz"))!.id).toBe(funk.parent_id);
    const newMedia = /\/media\/([\w-]+\.jpg)/.exec(funk.content)![1];
    expect(newMedia).not.toBe(m.name); // file was re-stored through the upload pipeline under a new name
    expect(existsSync(path.join(dir(), "media", newMedia))).toBe(true);
    expect((await backlinks("einsatz")).map((b) => b.slug)).toEqual(["funk"]);
  });
  it("conflict handling: skip, new version, copy", async () => {
    const z = tmp("c.zip", zip({ "funk.md": "---\ntitle: Funk\n---\nNeu!" }));
    expect((await importArchive(z, { apply: false, conflict: "skip", userId: uid })).pages[0].action).toBe("skip");
    const ow = await importArchive(z, { apply: true, conflict: "overwrite", userId: uid });
    expect(ow.updated).toBe(1);
    expect((await getPage("funk"))!.content).toBe("Neu!");
    expect((await getPage("funk"))!.rev).toBe(2);
    const cp = await importArchive(z, { apply: true, conflict: "copy", userId: uid });
    expect(cp.created).toBe(1);
    expect(await getPage("funk-2")).toBeDefined();
  });
  it("preview writes nothing", async () => {
    const before = await db().prepare("SELECT COUNT(*) n FROM pages").get();
    const p = await importArchive(
      tmp("p.zip", zip({ "neu.md": "# Neu", "_media/a.jpg": new Uint8Array(fx("exif.jpg")) })),
      { apply: false, conflict: "skip", userId: uid },
    );
    expect(p.pages[0]).toMatchObject({ title: "Neu", action: "create" });
    expect(p.media).toBe(1);
    expect(await db().prepare("SELECT COUNT(*) n FROM pages").get()).toEqual(before);
  });
});

describe("arranging an import", () => {
  const files = {
    "handbuch/index.md": "# Handbuch",
    "handbuch/start.md": "# Start",
    "handbuch/netz/index.md": "# Netz",
    "handbuch/netz/vlan.md": "# VLAN",
    "notizen.md": "# Notizen",
  };
  const layoutOf = (pages: { key: string; parentKey: string | null }[]) =>
    pages.map((p) => ({ key: p.key, parent: p.parentKey, include: true }));

  it("reorders, promotes, demotes, renames and leaves out pages; siblings keep the chosen order", async () => {
    const z = tmp("arr.zip", zip(files));
    const prev = await importArchive(z, { apply: false, conflict: "skip", userId: uid });
    expect(prev.pages.map((p) => p.key)).toEqual([
      "handbuch",
      "notizen",
      "handbuch/netz",
      "handbuch/start",
      "handbuch/netz/vlan",
    ]);
    const layout = [
      { key: "notizen", parent: null, include: true, title: "  Notizen   & Ideen " }, // first, renamed
      { key: "handbuch", parent: null, include: true },
      { key: "handbuch/start", parent: "handbuch", include: true },
      { key: "handbuch/netz", parent: "handbuch", include: false }, // left out …
      { key: "handbuch/netz/vlan", parent: "handbuch/netz", include: true }, // … its child moves up
    ];
    const r = await importArchive(z, { apply: true, conflict: "skip", userId: uid, layout });
    expect(r).toMatchObject({ created: 4, excluded: 1 });
    expect(await getPage("netz")).toBeUndefined();
    const hb = (await getPage("handbuch"))!;
    expect((await getPage("vlan"))!.parent_id).toBe(hb.id);
    expect((await getPage("notizen"))!.title).toBe("Notizen & Ideen");
    const tree = await getTree();
    const roots = tree.map((n) => n.slug);
    expect(roots.indexOf("notizen")).toBeLessThan(roots.indexOf("handbuch"));
    expect(tree.find((n) => n.slug === "handbuch")!.children.map((c) => c.slug)).toEqual(["start", "vlan"]);
  });

  it("puts pages under an existing wiki page, within the nesting limit", async () => {
    const host = await createPage({ title: "Ziel Kapitel", content: "", parentId: null, userId: uid });
    const z = tmp("arr2.zip", zip({ "a/index.md": "# Arr A", "a/b.md": "# Arr B" }));
    const r = await importArchive(z, {
      apply: true,
      conflict: "copy",
      userId: uid,
      layout: [
        { key: "a", parent: `page:${host.id}`, include: true },
        { key: "a/b", parent: "a", include: true },
      ],
    });
    expect(r.created).toBe(2);
    const a = (await getPage("a"))!;
    expect(a.parent_id).toBe(host.id);
    expect((await getPage("b"))!.parent_id).toBe(a.id);
    // one level deeper and B would be on level 4: refused as a whole, nothing written
    const sub = await createPage({ title: "Ziel Unter", content: "", parentId: host.id, userId: uid });
    const before = (await db().prepare("SELECT COUNT(*) n FROM pages").get()) as { n: number };
    await expect(
      importArchive(tmp("arr3.zip", zip({ "c/index.md": "# Arr C", "c/d.md": "# Arr D" })), {
        apply: true,
        conflict: "copy",
        userId: uid,
        layout: [
          { key: "c", parent: `page:${sub.id}`, include: true },
          { key: "c/d", parent: "c", include: true },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await db().prepare("SELECT COUNT(*) n FROM pages").get()).toEqual(before);
  });

  it("refuses arrangements that don't fit the archive: missing or extra pages, loops, odd values", async () => {
    const z = tmp("arr4.zip", zip(files));
    const base = layoutOf((await importArchive(z, { apply: false, conflict: "copy", userId: uid })).pages);
    const bad: unknown[] = [
      null,
      "x",
      {},
      base.slice(1), // a page missing
      [...base, { key: "extra", parent: null, include: true }],
      [...base.slice(1), base[1]], // the same page twice
      base.map((x, i) => (i === 0 ? { ...x, key: "../../etc" } : x)),
      base.map((x, i) => (i === 0 ? { ...x, include: "yes" } : x)),
      base.map((x, i) => (i === 0 ? { ...x, parent: "page:0" } : x)),
      base.map((x, i) => (i === 0 ? { ...x, parent: "page:1 OR 1=1" } : x)),
      base.map((x, i) => (i === 0 ? { ...x, parent: "page:99999999" } : x)), // doesn't exist
      base.map((x, i) => (i === 0 ? { ...x, parent: x.key } : x)), // itself
      base.map((x, i) => (i === 0 ? { ...x, title: 42 } : x)),
      base.map((x) => (x.key === "handbuch" ? { ...x, parent: "handbuch/netz/vlan" } : x)), // a loop
      base.map((x) => (x.key === "notizen" ? { ...x, parent: "handbuch/netz/vlan" } : x)), // level 4
    ];
    const before = (await db().prepare("SELECT COUNT(*) n FROM pages").get()) as { n: number };
    for (const layout of bad)
      await expect(
        importArchive(z, { apply: true, conflict: "copy", userId: uid, layout }),
        JSON.stringify(layout)?.slice(0, 80),
      ).rejects.toMatchObject({ status: 400 });
    expect(await db().prepare("SELECT COUNT(*) n FROM pages").get()).toEqual(before);
  });

  it("an existing page that is kept stays where it is; its level counts for what goes under it", async () => {
    const ch = await createPage({ title: "Stay Kapitel", content: "", parentId: null, userId: uid });
    const lvl2 = await createPage({ title: "Stay Mitte", content: "alt", parentId: ch.id, userId: uid });
    await createPage({ title: "Stay Unten", content: "", parentId: lvl2.id, userId: uid }); // stay-unten, level 3
    // the archive has "stay-unten" at the top with a child: kept in place (level 3), the child would be level 4
    const z = tmp("arr5.zip", zip({ "stay-unten/index.md": "# neu", "stay-unten/kind.md": "# Kind" }));
    const p = await importArchive(z, { apply: false, conflict: "skip", userId: uid });
    expect(p.pages.find((x) => x.key === "stay-unten")).toMatchObject({
      exists: true,
      existingDepth: 3,
      action: "skip",
    });
    await expect(
      importArchive(z, { apply: true, conflict: "skip", userId: uid, layout: layoutOf(p.pages) }),
    ).rejects.toMatchObject({ status: 400 });
    // put the child at the top level instead: fine
    const r = await importArchive(z, {
      apply: true,
      conflict: "skip",
      userId: uid,
      layout: [
        { key: "stay-unten", parent: null, include: true },
        { key: "stay-unten/kind", parent: null, include: true },
      ],
    });
    expect(r).toMatchObject({ created: 1, skipped: 1 });
    expect((await getPage("stay-unten"))!.parent_id).toBe(lvl2.id); // untouched
  });

  it("a staged preview belongs to the person who uploaded it and expires when replaced", async () => {
    const a = tmp("st1.zip", zip(files));
    const tok = stageUpload(a, 1, "st1.zip");
    expect(existsSync(a)).toBe(false); // moved into the staging area
    expect(stagedUpload(tok, 1).name).toBe("st1.zip");
    expect(() => stagedUpload(tok, 2)).toThrow(/expired/); // someone else's token is just "expired"
    for (const t of ["", "../x", tok + "x", tok.toUpperCase() === tok ? "a".repeat(32) : tok.toUpperCase(), 42, null])
      expect(() => stagedUpload(t, 1)).toThrow(/expired/);
    const tok2 = stageUpload(tmp("st2.zip", zip(files)), 1, "st2.zip");
    expect(() => stagedUpload(tok, 1)).toThrow(/expired/); // one per person: the older one is gone
    const f = stagedUpload(tok2, 1).file;
    dropStaged(tok2);
    expect(existsSync(f)).toBe(false);
  });
});

describe("hostile archives", () => {
  it("zip-slip names are only ever names: unsafe ones are skipped, nothing lands outside", async () => {
    const before = readdirSync(dir()).sort();
    const r = await importArchive(
      tmp(
        "slip.zip",
        zip({
          "../../etc/evil.md": "x",
          "/abs.md": "x",
          "a/../../b.md": "x",
          "..\\win.md": "x",
          "__MACOSX/._x.md": "x",
          ".hidden.md": "x",
          "_media/../../../escape.jpg": new Uint8Array(fx("exif.jpg")),
          "ok.md": "fine",
        }),
      ),
      { apply: true, conflict: "copy", userId: uid },
    );
    expect(r.created).toBe(1);
    expect(r.warnings.filter((w) => /unsafe path/.test(w)).length).toBeGreaterThanOrEqual(4);
    expect(readdirSync(dir()).sort()).toEqual([...before, "slip.zip"].sort());
    expect(existsSync(path.join(dir(), "..", "escape.jpg"))).toBe(false);
  });
  it("decompression bombs stop at the limit while inflating", async () => {
    const bomb = zip({ "big.md": new Uint8Array(3 * 1024 * 1024) }); // 3 MB of zeros -> a few KB compressed
    expect(bomb.length).toBeLessThan(20_000);
    const r = await importArchive(tmp("bomb1.zip", bomb), { apply: true, conflict: "copy", userId: uid });
    expect(r.created).toBe(0);
    expect(r.warnings.join()).toMatch(/too large/);
    const old = IMPORT_LIMITS.markdownTotal;
    IMPORT_LIMITS.markdownTotal = 600 * 1024;
    try {
      const many = zip(
        Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`p${i}.md`, new Uint8Array(400 * 1024).fill(65)])),
      );
      await expect(
        importArchive(tmp("bomb2.zip", many), { apply: true, conflict: "copy", userId: uid }),
      ).rejects.toThrow(/more data than allowed/);
    } finally {
      IMPORT_LIMITS.markdownTotal = old;
    }
    const oldN = IMPORT_LIMITS.entries;
    IMPORT_LIMITS.entries = 10;
    try {
      await expect(
        importArchive(
          tmp("many.zip", zip(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}.md`, "x"])))),
          { apply: false, conflict: "skip", userId: uid },
        ),
      ).rejects.toThrow(/too many files/);
    } finally {
      IMPORT_LIMITS.entries = oldN;
    }
  });
  it("garbage, truncated archives and disguised files fail cleanly", async () => {
    const good = zip({ "a.md": "hello ".repeat(2000) });
    await expect(
      importArchive(tmp("trunc.zip", good.subarray(0, 60)), { apply: true, conflict: "copy", userId: uid }),
    ).rejects.toThrow(/can’t be read/);
    const svg = await importArchive(
      tmp("svg.zip", zip({ "_media/x.png": '<svg onload="alert(1)"></svg>'.padEnd(200), "s.md": "![](/media/x.png)" })),
      { apply: true, conflict: "copy", userId: uid },
    );
    expect(svg.warnings.join()).toMatch(/not a supported image/);
    expect(await db().prepare("SELECT COUNT(*) n FROM media WHERE original_name='x.png'").get()).toEqual({ n: 0 });
    const bin = await importArchive(
      tmp("bin.zip", zip({ "b.md": new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2]) })),
      { apply: true, conflict: "copy", userId: uid },
    );
    expect(bin.warnings.join()).toMatch(/not a text file/);
  });
  it("deep folders are flattened to the allowed depth; same names in different folders don't collide", async () => {
    const r = await importArchive(
      tmp("deep.zip", zip({ "x/y/z/w/deep.md": "# Tief", "k1/intro.md": "1", "k2/intro.md": "2" })),
      { apply: true, conflict: "skip", userId: uid },
    );
    expect(r.warnings.join()).toMatch(/nested too deeply/);
    const deep = (await getPage("deep"))!;
    expect((await getPage("y"))!.id).toBe(deep.parent_id);
    const intros = await db().prepare("SELECT content FROM pages WHERE slug LIKE 'intro%' ORDER BY slug").all();
    expect(intros).toEqual([{ content: "1" }, { content: "2" }]);
  });
  it("a single .md file imports as one page", async () => {
    const r = await importArchive(tmp("one", "---\ntitle: Einzel\n---\nText"), {
      apply: true,
      conflict: "copy",
      userId: uid,
      singleName: "einzel.md",
    });
    expect(r.created).toBe(1);
    expect((await getPage("einzel"))!.title).toBe("Einzel");
  });
});

describe("conventional features", () => {
  it("recent changes, reading order and backlinks follow edits", async () => {
    const p = (await getPage("einsatz"))!;
    await updatePage("einsatz", {
      title: p.title,
      content: "Mehr Text. Siehe auch [Funk](/w/funk).",
      parentId: null,
      expectedRev: p.rev,
      userId: uid,
    });
    expect((await recentChanges(5))[0]).toMatchObject({ slug: "einsatz", rev: p.rev + 1 });
    expect((await backlinks("funk")).map((b) => b.slug)).toContain("einsatz");
    const order = (await readingOrder()).map((o) => o.slug);
    expect(order.indexOf("funk")).toBe(order.indexOf("einsatz") + 1);
    expect((await getTree()).length).toBeGreaterThan(0);
  });
});

describe("hardening", () => {
  it("Argon2 queue is bounded: a flood gets 'busy' instead of piling up", async () => {
    const h = await hashPassword(PW);
    const results = await Promise.allSettled(Array.from({ length: 80 }, () => verifyPassword(h, PW)));
    const busy = results.filter(
      (r) => r.status === "rejected" && /busy/.test(String((r as PromiseRejectedResult).reason?.message)),
    ).length;
    expect(busy).toBeGreaterThan(0);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(51);
    expect(await verifyPassword(h, PW)).toBe(true); // recovers
  }, 60_000);
  it("hammering a locked account writes one log entry per minute, not one per request", async () => {
    await db().prepare("DELETE FROM lockouts").run();
    await db().prepare("DELETE FROM rate_limits").run();
    for (let i = 0; i < 5; i++) await auth.attemptLogin("chef", "wrong-wrong-wrong-1", null, null);
    for (let i = 0; i < 25; i++) expect((await auth.attemptLogin("chef", PW, null, null)).status).toBe("blocked");
    expect((await queryAudit({ q: "login.blocked" })).rows.length).toBe(1);
    await db().prepare("DELETE FROM lockouts").run();
  });
  it("counters for non-existent names are capped", async () => {
    await db()
      .prepare(
        "INSERT INTO lockouts(key,user_id,fails,window_start) SELECT 'fail:id:fake' || g, NULL, 1, ? FROM generate_series(0, 19999) g",
      )
      .run(Math.floor(Date.now() / 1000));
    await auth.attemptLogin("brand-new-name", "x-wrong-password-1", null, null);
    expect(await db().prepare("SELECT 1 FROM lockouts WHERE key='fail:id:brand-new-name'").get()).toBeUndefined();
    await db().prepare("DELETE FROM lockouts").run();
  });
  it("sessions per person are capped", async () => {
    for (let i = 0; i < 40; i++) await auth.createSession(uid, "full", 3600, null, null);
    expect(await db().prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?").get(uid)).toEqual({ n: 30 });
  });
});
