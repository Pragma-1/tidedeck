import "./setup-env";
import { beforeAll, describe, expect, it } from "vitest";
import { addUser, db } from "./pg";
import { createPage, updatePage } from "@/lib/pages";
import { trashPage } from "@/lib/trash";
import { fold, globMatch, markdownToPlain, parseQuery, search, type Segment } from "@/lib/search";

const join = (segs: Segment[]) => segs.map((s) => s.t).join("");
const hits = (segs: Segment[]) => segs.filter((s) => s.hit).map((s) => s.t);
const slugs = async (q: string) => (await search(q, { limit: 100 })).hits.map((h) => h.slug).sort();

describe("search", () => {
  let uid = 0;
  const mk = (title: string, content: string) => createPage({ title, content, parentId: null, userId: uid });
  beforeAll(async () => {
    uid = await addUser("s");
    await mk("Bitte lesen", "Hier stehen wichtige Inhalte. Der Text ist kurz.");
    await mk("Straßenbau", "Planung für die neue Straße am Hafen. Tests folgen.");
    await mk("Zeitplan", "Termine: Testlauf am Montag, Taust ist kein Wort. Wiki-Pflege und Wikipedia.");
    await mk(
      "Code",
      "```js\nconst geheimnis = 42;\n```\nEin [Link](https://example.org/versteckt-in-url) und [[Bitte lesen|interner Verweis]].",
    );
  });

  it("folds case, accents and ß", async () => {
    expect(fold("Straße ÄÖÜ é ﬁ")).toBe("strasse aou e fi");
    expect(fold("ΣΑΣ")).toBe("σασ");
  });

  it("finds substrings anywhere in a word, not just at the start", async () => {
    expect(await slugs("te")).toEqual(expect.arrayContaining(["bitte-lesen", "zeitplan", "strassenbau"]));
    expect(await slugs("itte")).toEqual(["bitte-lesen"]);
    expect(await slugs("halte")).toEqual(["bitte-lesen"]); // inside "Inhalte"
  });

  it("is case- and accent-insensitive in both directions", async () => {
    expect(await slugs("STRASSE")).toEqual(["strassenbau"]);
    expect(await slugs("fur")).toEqual(["strassenbau"]);
    expect(await slugs("für")).toEqual(["strassenbau"]);
    expect(await slugs("hafen")).toEqual(["strassenbau"]);
  });

  it("supports * wildcards anchored to word boundaries", async () => {
    expect(await slugs("wiki*")).toEqual(["zeitplan"]);
    expect(await slugs("*bau")).toEqual(["strassenbau"]); // title word
    expect(await slugs("t*st")).toEqual(["zeitplan"]); // "Taust" (not "Test" in "Tests" or "Testlauf")
    expect(await slugs("test*")).toEqual(expect.arrayContaining(["strassenbau", "zeitplan"]));
    expect(await slugs("*xyz*")).toEqual([]);
    expect(await slugs("*")).toEqual([]);
  });

  it("phrases and multiple terms (all must match)", async () => {
    expect(await slugs('"neue straße"')).toEqual(["strassenbau"]);
    expect(await slugs('"straße neue"')).toEqual([]);
    expect(await slugs("termine montag")).toEqual(["zeitplan"]);
    expect(await slugs("termine hafen")).toEqual([]);
  });

  it("searches the readable text, not markup or link targets", async () => {
    expect(await slugs("versteckt")).toEqual([]);
    expect(await slugs("geheimnis")).toEqual(["code"]); // code blocks are content
    expect(await slugs("interner verweis")).toEqual(["code"]);
    expect(markdownToPlain("# T\n**fett** [x](https://a.b/c) @[Video](https://y.z) [[Seite|Label]]")).toBe(
      "T\nfett x Video Label",
    );
  });

  it("highlights hits as segments that reproduce the original text exactly", async () => {
    const r = (await search("straße")).hits[0];
    expect(join(r.title)).toBe("Straßenbau");
    expect(hits(r.title)).toEqual(["Straße"]);
    expect(hits(r.snippet)).toEqual(["Straße"]);
    const w = (await search("wiki*")).hits[0];
    expect(hits(w.snippet)).toEqual(["Wiki-Pflege", "Wikipedia"]);
  });

  it("keeps the index in step with edits and deletions", async () => {
    const p = await mk("Flüchtig", "Einmaliger Begriff Quokka");
    expect(await slugs("quokka")).toEqual([p.slug]);
    await updatePage(p.slug, {
      title: "Flüchtig",
      content: "jetzt Wombat",
      parentId: null,
      expectedRev: 1,
      userId: uid,
    });
    expect(await slugs("quokka")).toEqual([]);
    expect(await slugs("wombat")).toEqual([p.slug]);
    await trashPage(p.slug, uid);
    expect(await slugs("wombat")).toEqual([]);
    // pages written without the app code (e.g. seed, import) are indexed too
    const t = Math.floor(Date.now() / 1000);
    await db()
      .prepare(
        "INSERT INTO pages(slug,title,parent_id,position,content,rev,created_at,updated_at) VALUES('roh','Roh',NULL,99,'Kakapo',1,?,?)",
      )
      .run(t, t);
    expect(await slugs("kakapo")).toEqual(["roh"]);
  });

  it("treats every query as data: no SQL/FTS syntax, no regex, no crash", async () => {
    for (const q of [
      '"',
      '""',
      "* OR 1",
      "a AND NOT b",
      "title:x",
      "NEAR(a b)",
      "'; DROP TABLE pages;--",
      "\\",
      "%",
      "_",
      "(.*)+$",
      "\u0000\u0001",
      "💩",
      "*".repeat(300),
      "a*".repeat(100),
    ]) {
      await expect(search(q)).resolves.toBeDefined();
    }
    expect(await slugs("%")).toEqual([]);
    expect(await slugs("_")).toEqual([]);
    expect(await db().prepare("SELECT COUNT(*) n FROM pages").get()).toMatchObject({ n: expect.any(Number) });
  });

  it("caps terms and length, and pathological wildcards stay linear", async () => {
    expect(parseQuery("a b c d e f g h i j k").length).toBe(8);
    expect(parseQuery("x".repeat(500))[0].text.length).toBe(64);
    // a classic catastrophic-backtracking shape against a long word
    const word = "a".repeat(5000) + "b";
    const t0 = performance.now();
    expect(
      globMatch(word, { parts: ["a", "a", "a", "a", "a", "a", "a", "c"], anchorStart: false, anchorEnd: true }),
    ).toBe(false);
    expect(performance.now() - t0).toBeLessThan(50);
    const big = await mk("Gross", ("lorem ipsum dolor " + "a".repeat(200) + " ").repeat(1500));
    const t1 = performance.now();
    await search("*a*a*a*a*a*a*c*", { budgetMs: 200 });
    expect(performance.now() - t1).toBeLessThan(1500);
    await trashPage(big.slug, uid);
  });

  it("glob matching semantics", async () => {
    const g = (w: string, pat: string) => {
      const t = parseQuery(pat)[0];
      return globMatch(w, t);
    };
    expect(g("testing", "test*")).toBe(true);
    expect(g("contest", "test*")).toBe(false);
    expect(g("contest", "*test")).toBe(true);
    expect(g("tst", "t*st")).toBe(true); // * may match nothing
    expect(g("ts", "t*st")).toBe(false); // but parts must not overlap
  });
});
