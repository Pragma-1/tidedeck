// Copies the selectable fonts from node_modules to public/fonts, one stylesheet per
// font, so a page loads only the font in use (and none of the others' CSS).
// Runs before `next dev` and `next build` (see package.json).
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const require = createRequire(path.join(root, "package.json"))
const fonts = JSON.parse(readFileSync(path.join(root, "lib/font-files.json"), "utf8"))
const out = path.join(root, "public/fonts")

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
let files = 0
for (const [id, { pkg, css }] of Object.entries(fonts)) {
  if (!/^[a-z0-9]+$/.test(id)) throw new Error(`Bad font id ${id}`)
  const dir = path.dirname(require.resolve(`${pkg}/package.json`))
  const { version } = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))
  mkdirSync(path.join(out, id))
  let sheet = `/* ${pkg} ${version} (see its LICENSE) */\n`
  for (const name of css) {
    const text = readFileSync(path.join(dir, name), "utf8")
    sheet += text
      // The .woff fallback is for browsers older than anything Tidedeck runs in: not shipped.
      .replace(/,\s*url\(\.\/files\/[\w.-]+\.woff\)\s*format\('woff'\)/g, "")
      .replace(/url\(\.\/files\/([\w.-]+\.woff2)\)/g, (_, file) => {
        copyFileSync(path.join(dir, "files", file), path.join(out, id, file))
        files++
        return `url(/fonts/${id}/${file}?v=${version})`
      })
    if (/url\(\.\//.test(sheet)) throw new Error(`${pkg}: a font file reference wasn't rewritten`)
  }
  copyFileSync(path.join(dir, "LICENSE"), path.join(out, id, "LICENSE"))
  writeFileSync(path.join(out, `${id}.css`), sheet)
}
console.log(`fonts: ${Object.keys(fonts).length} fonts, ${files} files → public/fonts`)
