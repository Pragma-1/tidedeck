// Copies the static assets next to the standalone server, the same way the Dockerfile does,
// so `node .next/standalone/server.js` (and the end-to-end test) serve CSS, JS and fonts.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const standalone = path.join(root, ".next/standalone");
if (!existsSync(standalone)) {
  console.error("No standalone build found. Run `npm run build` first.");
  process.exit(1);
}
cpSync(path.join(root, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
if (existsSync(path.join(root, "public")))
  cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
console.log("Static assets copied into .next/standalone");
