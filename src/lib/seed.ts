import { all, one, run, sql, tx, now } from "./db";
import { publish } from "./events";
import type { Lang } from "./i18n";

const WELCOME_EN = `# Welcome

This wiki is **live**: when someone saves a page, everyone reading it sees the change appear. Signed-in people can add chapters and pages; everyone else gets a read-only view.

::: tip Quick start
Pick **New page** in the sidebar, give it a title, and start writing in Markdown. The preview updates while you type.
:::

Link to other pages with double brackets, like [[Markdown guide]] or [[Markdown guide|the formatting cheat sheet]].
`;

const MEDIA_EN = `
## Images and videos

Upload pictures and videos with the image button in the editor, by pasting or by dragging them into the text. Each upload inserts a line like these:

\`\`\`md
![Team photo](/media/…jpg)
@[Training video](/media/…mp4)
\`\`\`

Embed videos from other sites with \`@[title](link)\`: YouTube and Vimeo show a player that only loads after a click, a direct link to a video file plays right here, and any other link becomes a link card:

\`\`\`md
@[Introduction](https://www.youtube.com/watch?v=…)
@[Recording on another platform](https://example.org/video/123)
\`\`\`
`;
const MEDIA_DE = `
## Bilder und Videos

Bilder und Videos laden Sie im Editor mit der Bild-Schaltfläche hoch, durch Einfügen oder indem Sie sie in den Text ziehen. Jeder Upload fügt eine Zeile wie diese ein:

\`\`\`md
![Teamfoto](/media/…jpg)
@[Schulungsvideo](/media/…mp4)
\`\`\`

Videos von anderen Seiten betten Sie mit \`@[Titel](Link)\` ein: YouTube und Vimeo zeigen einen Player, der erst nach einem Klick lädt, ein direkter Link auf eine Videodatei wird hier abgespielt, und jeder andere Link wird zu einer Linkkarte:

\`\`\`md
@[Einführung](https://www.youtube.com/watch?v=…)
@[Aufzeichnung auf einer anderen Plattform](https://example.org/video/123)
\`\`\`
`;

const GUIDE_EN_V1 = `# Markdown guide

Everything below is rendered from plain text. Open this page in the editor to see how it is written.

## Text

You can write **bold**, *italic*, ~~strikethrough~~, ==highlighted==, ++inserted++ text, H~2~O and x^2^.
Autolinks work too: https://example.org

> Blockquotes are for quoting.
> They can span several lines.

## Lists

- Unordered item
  - Nested item
- Another item

1. First
2. Second

- [x] Task lists
- [ ] with checkboxes

Term
:   Definition lists describe a term.

## Code

Inline \`code\` and fenced blocks with syntax highlighting:

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Tables

| Feature | Supported | Notes |
|:--------|:---------:|------:|
| Tables  | yes       | aligned |
| Footnotes | yes     | see below |

## Callouts

::: info Heads up
Callouts come in four flavours: info, tip, warning and danger.
:::

::: warning
Warnings need no title.
:::

::: details Click to expand
Hidden content lives in a details block.
:::

## More

Footnotes[^1], abbreviations like HTML, emoji :tada: and horizontal rules are supported.

*[HTML]: HyperText Markup Language

---

[^1]: This is the footnote text.
`;

const WELCOME_DE = `# Willkommen

Dieses Wiki ist **live**: Sobald jemand eine Seite speichert, sehen alle, die sie gerade lesen, die Änderung. Angemeldete Personen können Kapitel und Seiten anlegen, alle anderen haben Lesezugriff.

::: tip Schnellstart
Wählen Sie in der Seitenleiste **Neue Seite**, geben Sie einen Titel ein und schreiben Sie in Markdown. Die Vorschau aktualisiert sich beim Tippen.
:::

Andere Seiten verlinken Sie mit doppelten eckigen Klammern, etwa [[Markdown guide|Markdown-Anleitung]] oder [[Markdown guide|die Formatierungsübersicht]].
`;

const GUIDE_DE_V1 = `# Markdown-Anleitung

Alles hier wird aus reinem Text erzeugt. Öffnen Sie diese Seite im Editor, um zu sehen, wie sie geschrieben ist.

## Text

Sie können **fett**, *kursiv*, ~~durchgestrichen~~, ==hervorgehoben==, ++eingefügt++ schreiben, außerdem H~2~O und x^2^.
Links werden automatisch erkannt: https://example.org

> Zitatblöcke sind für Zitate.
> Sie können mehrere Zeilen umfassen.

## Listen

- Ungeordneter Eintrag
  - Verschachtelter Eintrag
- Noch ein Eintrag

1. Erstens
2. Zweitens

- [x] Aufgabenlisten
- [ ] mit Kontrollkästchen

Begriff
:   Definitionslisten erklären einen Begriff.

## Code

Inline-\`Code\` und Codeblöcke mit Syntaxhervorhebung:

\`\`\`ts
export function greet(name: string): string {
  return \`Hallo, \${name}!\`;
}
\`\`\`

## Tabellen

| Funktion | Unterstützt | Hinweis |
|:---------|:-----------:|--------:|
| Tabellen | ja          | ausgerichtet |
| Fußnoten | ja          | siehe unten |

## Hinweisboxen

::: info Zur Info
Hinweisboxen gibt es in vier Arten: info, tip, warning und danger.
:::

::: warning
Warnungen brauchen keinen Titel.
:::

::: details Zum Aufklappen klicken
Versteckter Inhalt steht in einem Details-Block.
:::

## Mehr

Fußnoten[^1], Abkürzungen wie HTML, Emoji :tada: und horizontale Linien werden unterstützt.

*[HTML]: HyperText Markup Language

---

[^1]: Das ist der Fußnotentext.
`;

// v2 (shipped earlier): v1 + images and videos
const GUIDE_EN_V2 = GUIDE_EN_V1.replace("\n## More\n", `${MEDIA_EN}\n## More\n`);
const GUIDE_DE_V2 = GUIDE_DE_V1.replace("\n## Mehr\n", `${MEDIA_DE}\n## Mehr\n`);

// v3: links in new tabs, wiki links, picture-in-picture, copy button, .md import, search syntax
const LINKS_DE = `
## Links

- Seiten dieses Wikis verlinken Sie mit doppelten eckigen Klammern: \`[[Willkommen]]\` oder mit eigenem Text \`[[Willkommen|zur Startseite]]\`.
- Normale Links schreiben Sie als \`[Text](https://example.org)\`; eine nackte Adresse wie https://example.org wird automatisch zum Link.
- **Links auf andere Websites öffnen sich in einem neuen Tab** und tragen ein kleines ↗. Links innerhalb des Wikis bleiben im selben Tab.
- Unten auf jeder Seite listet „Verlinkt von“ alle Seiten, die hierher verweisen.
`;
const LINKS_EN = `
## Links

- Link to pages of this wiki with double brackets: \`[[Welcome]]\` or with your own text \`[[Welcome|to the start page]]\`.
- Regular links are written as \`[text](https://example.org)\`; a bare address like https://example.org becomes a link automatically.
- **Links to other websites open in a new tab** and carry a small ↗. Links inside the wiki stay in the same tab.
- At the bottom of every page, "Linked from" lists every page that points here.
`;
const MEDIA_DE_V3 =
  MEDIA_DE +
  `
Jedes Video lässt sich mit **Bild-in-Bild** unter dem Player aus der Seite lösen: Es läuft dann in einem kleinen Fenster weiter, während Sie weiterlesen und scrollen. Ein zweiter Klick (oder Esc) holt es zurück. Hochgeladene Videos nutzen das Bild-in-Bild des Browsers, YouTube und Vimeo einen Mini-Player in der Ecke. Der Link „Auf YouTube öffnen“ und Linkkarten öffnen sich in einem neuen Tab.
`;
const MEDIA_EN_V3 =
  MEDIA_EN +
  `
Every video can be detached from the page with **Picture-in-picture** below the player: it keeps playing in a small window while you read on and scroll. A second click (or Esc) brings it back. Uploaded videos use the browser's own picture-in-picture, YouTube and Vimeo a mini player in the corner. "Open on YouTube" and link cards open in a new tab.
`;
const WORKFLOW_DE = `
## Codeblöcke kopieren

Fährt man über einen Codeblock, erscheint oben rechts **Code kopieren** — ein Klick legt den ganzen Block in die Zwischenablage.

## Markdown-Dateien importieren

Unter **Neue Seite** in der Seitenleiste gibt es **.md importieren**: Datei wählen oder hineinziehen, Titel und Text werden übernommen (aus dem Front Matter \`title:\` oder der ersten Überschrift \`# …\`). Gespeichert wird erst, wenn Sie „Seite speichern“ drücken. Im Editor öffnet die Schaltfläche mit dem Datei-Symbol eine .md-Datei in die aktuelle Seite. Ganze Sammlungen (ZIP) importieren Administratoren unter Einstellungen → Import & Export.

## Suchen

Die Suche oben zeigt Treffer schon beim Tippen; **Enter** öffnet die Ergebnisseite mit allen Seiten, die passen.

| Eingabe | findet |
|:--------|:-------|
| \`te\` | „te“ an jeder Stelle eines Wortes: *Te*xt, Bit*te*, Inhal*te* |
| \`wiki*\` | Wörter, die mit „wiki“ beginnen |
| \`*ung\` | Wörter, die auf „ung“ enden |
| \`t*st\` | Wörter, die mit „t“ beginnen und auf „st“ enden: Test, Taust |
| \`"neue seite"\` | genau diese Wortfolge |
| \`video upload\` | Seiten, die beide Begriffe enthalten |

Groß- und Kleinschreibung sowie Akzente spielen keine Rolle: \`fur\` findet auch „für“, \`strasse\` auch „Straße“.
`;
const WORKFLOW_EN = `
## Copying code blocks

Hover over a code block and **Copy code** appears in its top-right corner — one click puts the whole block on the clipboard.

## Importing Markdown files

Below **New page** in the sidebar there is **Import .md**: choose or drop a file, and its title and text are filled in (from the front matter \`title:\` or the first heading \`# …\`). Nothing is saved until you press "Save page". In the editor, the button with the file symbol opens a .md file into the current page. Whole collections (ZIP) are imported by administrators under Settings → Import & export.

## Searching

The search box at the top shows matches while you type; **Enter** opens the results page with every page that matches.

| You type | finds |
|:---------|:------|
| \`te\` | "te" anywhere in a word: *te*xt, wri*te*, no*te*s |
| \`wiki*\` | words that start with "wiki" |
| \`*ing\` | words that end in "ing" |
| \`t*st\` | words that start with "t" and end in "st": test, toast |
| \`"new page"\` | exactly this phrase |
| \`video upload\` | pages that contain both words |

Case and accents don't matter: \`fur\` also finds "für", \`strasse\` also "Straße".
`;
const GUIDE_DE = GUIDE_DE_V1.replace(
  "Alles hier wird aus reinem Text erzeugt. Öffnen Sie diese Seite im Editor, um zu sehen, wie sie geschrieben ist.",
  "Alles hier wird aus reinem Text erzeugt. Öffnen Sie diese Seite im Editor (**Bearbeiten**), um zu sehen, wie sie geschrieben ist — die Vorschau neben dem Text zeigt jede Änderung sofort.",
)
  .replace("\n## Listen\n", `${LINKS_DE}\n## Listen\n`)
  .replace("\n## Mehr\n", `${MEDIA_DE_V3}${WORKFLOW_DE}\n## Mehr\n`);
const GUIDE_EN = GUIDE_EN_V1.replace("\n## Lists\n", `${LINKS_EN}\n## Lists\n`).replace(
  "\n## More\n",
  `${MEDIA_EN_V3}${WORKFLOW_EN}\n## More\n`,
);

/** Built-in pages in every language. Keys are stable; slugs never change so links keep working. */
export const SYSTEM_PAGES: Record<
  string,
  {
    slug: string;
    versions: Record<Lang, { title: string; content: string }>;
    legacy?: { title: string; content: string }[];
  }
> = {
  welcome: {
    slug: "welcome",
    versions: { en: { title: "Welcome", content: WELCOME_EN }, de: { title: "Willkommen", content: WELCOME_DE } },
  },
  "markdown-guide": {
    slug: "markdown-guide",
    versions: {
      en: { title: "Markdown guide", content: GUIDE_EN },
      de: { title: "Markdown-Anleitung", content: GUIDE_DE },
    },
    // earlier shipped texts: an untouched old copy still counts as "unedited" and gets upgraded
    legacy: [
      { title: "Markdown guide", content: GUIDE_EN_V1 },
      { title: "Markdown-Anleitung", content: GUIDE_DE_V1 },
      { title: "Markdown guide", content: GUIDE_EN_V2 },
      { title: "Markdown-Anleitung", content: GUIDE_DE_V2 },
    ],
  },
};

/** Inserted inside the setup transaction, so a fresh wiki is never empty. */
export async function seedPages(userId: number, lang: Lang) {
  const t = now();
  let i = 0;
  for (const [key, sp] of Object.entries(SYSTEM_PAGES)) {
    const v = sp.versions[lang];
    const r = await one<{ id: number }>(
      sql`INSERT INTO pages(slug, title, parent_id, position, content, rev, created_by, updated_by, created_at, updated_at, system_key)
          VALUES (${sp.slug}, ${v.title}, NULL, ${++i}, ${v.content}, 1, ${userId}, ${userId}, ${t}, ${t}, ${key})
          RETURNING id`,
    );
    await run(
      sql`INSERT INTO page_revisions(page_id, rev, title, content, author_id, created_at)
          VALUES (${r!.id}, 1, ${v.title}, ${v.content}, ${userId}, ${t})`,
    );
  }
}

/**
 * Switches built-in pages to the site language — but only while nobody has edited them, i.e.
 * while title and text still match one of the shipped versions exactly. Edited pages are never touched.
 */
export async function syncSystemPages(lang: Lang): Promise<number> {
  const rows = await all<{ id: number; slug: string; title: string; content: string; rev: number; system_key: string }>(
    sql`SELECT id, slug, title, content, rev, system_key FROM pages WHERE system_key IS NOT NULL`,
  );
  let changed = 0;
  for (const r of rows) {
    const sp = SYSTEM_PAGES[r.system_key];
    if (!sp) continue;
    const target = sp.versions[lang];
    if (r.title === target.title && r.content === target.content) continue;
    const pristine = [...Object.values(sp.versions), ...(sp.legacy ?? [])].some(
      (v) => v.title === r.title && v.content === r.content,
    );
    if (!pristine) continue;
    const t = now();
    const done = await tx(async () => {
      // only if nobody saved in between (the text is still the pristine one we compared)
      const rev = r.rev + 1;
      const n = await run(
        sql`UPDATE pages SET title = ${target.title}, content = ${target.content}, rev = ${rev}, updated_at = ${t}
            WHERE id = ${r.id} AND rev = ${r.rev}`,
      );
      if (n !== 1) return false;
      await run(
        sql`INSERT INTO page_revisions(page_id, rev, title, content, author_id, created_at)
            VALUES (${r.id}, ${rev}, ${target.title}, ${target.content}, NULL, ${t})`,
      );
      return true;
    });
    if (!done) continue;
    publish({ type: "page.updated", slug: r.slug, title: target.title, rev: r.rev + 1 });
    changed++;
  }
  return changed;
}
