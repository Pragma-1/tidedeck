import "./setup-env";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

const html = (s: string) => renderMarkdown(s).html;

const TAGS = new Set(
  "h1 h2 h3 h4 h5 h6 p br hr strong em del s ins mark sub sup code pre blockquote ul ol li dl dt dd table thead tbody tr th td a img input abbr section div span details summary".split(
    " ",
  ),
);
const ATTRS = new Set(
  "href title rel class id aria-hidden src alt loading decoding referrerpolicy width height type checked disabled style colspan rowspan start target".split(
    " ",
  ),
);
/** Structural check on the real output: only allow-listed tags/attributes, no dangerous URL schemes anywhere. */
function assertSafe(out: string) {
  for (const m of out.matchAll(/<\/?([a-zA-Z][\w:-]*)((?:\s+[^<>]*)?)\/?>/g)) {
    expect(TAGS.has(m[1].toLowerCase()), `tag <${m[1]}>`).toBe(true);
    for (const a of m[2].matchAll(/\s([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      expect(ATTRS.has(a[1].toLowerCase()), `attr ${a[1]}`).toBe(true);
      const val = (a[2] ?? a[3] ?? a[4] ?? "").replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
      if (["href", "src"].includes(a[1].toLowerCase()))
        expect(val, `${a[1]}=${val}`).not.toMatch(/^(?:javascript|vbscript|data|file):/);
      if (a[1].toLowerCase() === "target") expect(val, "target").toBe("_blank");
    }
    // every link that opens a new tab must cut the opener (reverse tabnabbing)
    if (/\starget=/.test(m[2])) expect(m[2]).toMatch(/rel="[^"]*noopener[^"]*"/);
  }
}

describe("XSS corpus", () => {
  const payloads = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<svg onload=alert(1)>",
    "<iframe src=javascript:alert(1)>",
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](  javascript:alert(1))",
    "[x](data:text/html;base64,PHNjcmlwdD4=)",
    "[x](vbscript:msgbox(1))",
    "![x](javascript:alert(1))",
    "![x](data:image/svg+xml;base64,PHN2Zz4=)",
    '<a href="javascript:alert(1)">x</a>',
    "<details open ontoggle=alert(1)>",
    "<style>*{display:none}</style>",
    "<form action=//evil><input name=x></form>",
    "<base href=//evil>",
    "<meta http-equiv=refresh content=0;url=//evil>",
    "<math><mi xlink:href=javascript:alert(1)>x</mi></math>",
    "<input autofocus onfocus=alert(1)>",
    "`<script>`",
    "[a](<javascript:alert(1)>)",
    "[a]: javascript:alert(1)\n\n[a]",
    '<https://x.com"onmouseover="alert(1)>',
    "# <img src=x onerror=alert(1)>",
    "::: info <script>alert(1)</script>\nx\n:::",
    '::: details "><img src=x onerror=alert(1)>\nx\n:::',
    "[[<img src=x onerror=alert(1)>]]",
    "[[a|<script>alert(1)</script>]]",
    "*[<b onclick=1>]: <script>",
    "[^1]: <script>\n\n[^1]",
  ];
  for (const p of payloads) {
    it(JSON.stringify(p).slice(0, 60), () => assertSafe(html(p)));
  }
  it("forces rel on links and safe attrs on images", () => {
    expect(html("[x](https://example.com)")).toContain('rel="noopener noreferrer nofollow ugc"');
    const img = renderMarkdown("![a](https://example.com/a.png)", { autoloadExternal: true }).html;
    expect(img).toContain('referrerpolicy="no-referrer"');
    expect(img).toContain('loading="lazy"');
  });
  it("strips DOM-clobbering ids and stray attributes", () => {
    const out = html("# Title");
    expect(out).toMatch(/id="h-title"/);
  });
  it("task list checkboxes are inert", () => {
    const out = html("- [x] done\n- [ ] todo");
    expect(out).toContain("disabled");
    expect(out).toContain('type="checkbox"');
  });
});

describe("features", () => {
  it("renders the common markdown feature set", () => {
    const md = `# H1\n\n**b** *i* ~~s~~ ==m== ++i++ H~2~O x^2^\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |\n\n- [x] t\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n\nterm\n:   def\n\nfoot[^1]\n\n[^1]: note\n\n:tada: HTML\n\n*[HTML]: Hyper\n\n[[Some Page]] [[Some Page|label]]\n\n::: warning Careful\nx\n:::\n\n::: details More\ny\n:::\n`;
    const { html: out, toc } = renderMarkdown(md);
    for (const needle of [
      "<strong>",
      "<em>",
      "<s>",
      "<mark>",
      "<ins>",
      "<sub>",
      "<sup>",
      "<table>",
      "text-align:center",
      "task-list-item",
      "hljs",
      "<dl>",
      "footnote",
      "🎉",
      "<abbr",
      'href="/w/some-page"',
      ">label<",
      "callout-warning",
      "<details>",
      "<summary>",
    ]) {
      expect(out, needle).toContain(needle);
    }
    expect(toc).toEqual([{ level: 1, text: "H1", id: "h-h1" }]);
  });
  it("handles pathological input without hanging", () => {
    const t = Date.now();
    html("[".repeat(20000) + "](" + "(".repeat(20000));
    html("*".repeat(50000));
    html("> ".repeat(5000) + "x");
    html("`".repeat(50000));
    expect(Date.now() - t).toBeLessThan(5000);
  });
});

describe("links open in a new tab only when they leave the wiki", () => {
  it("external http(s) links get target=_blank + rel=noopener; internal, anchors and mailto don't", () => {
    const out = html(
      "[a](https://example.org) [b](/w/start) [c](#x) [d](mailto:a@b.de) [[Start]] <https://example.net>",
    );
    expect(out).toMatch(
      /<a href="https:\/\/example\.org" rel="noopener noreferrer nofollow ugc" class="ext" target="_blank">a<\/a>|<a[^>]*href="https:\/\/example\.org"[^>]*target="_blank"[^>]*>a</,
    );
    for (const m of out.matchAll(/<a\b[^>]*>/g)) {
      const tag = m[0];
      const ext = /href="https?:\/\/example\.(org|net)"/.test(tag);
      expect(/target="_blank"/.test(tag), tag).toBe(ext);
      expect(tag).toMatch(/rel="noopener noreferrer nofollow ugc"/);
    }
  });
  it("a written target attribute can't sneak in (raw HTML is off, attrs are rebuilt)", () => {
    const out = html('<a href="/w/x" target="_top">x</a> [y](https://a.example "t" target=_self)');
    expect(out).not.toMatch(/target="_(top|self|parent)"/);
  });
});
