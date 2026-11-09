import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { DATA_DIR } from "@/lib/server/store"

export const ICON_DIR = path.join(DATA_DIR, "icons")
export const MAX_ICON_BYTES = 1024 * 1024
export const ICON_FILE = /^[a-f0-9]{32}\.(png|jpg|gif|webp|ico|svg)$/

export const ICON_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
}

/** Decides the type from the file's bytes, never from its name or the browser's claim. */
export function sniff(buf: Buffer): keyof typeof ICON_TYPES | null {
  if (buf.length < 12) return null
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png"
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg"
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "gif"
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp"
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return "ico"
  const head = buf.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg"
  return null
}

export async function saveIcon(buf: Buffer): Promise<string> {
  const ext = sniff(buf)
  if (!ext) throw new Error("Use a PNG, JPEG, GIF, WebP, ICO or SVG image")
  const name = `${createHash("sha256").update(buf).digest("hex").slice(0, 32)}.${ext}`
  await fs.mkdir(ICON_DIR, { recursive: true })
  const file = path.join(ICON_DIR, name)
  await fs.writeFile(file, buf, { flag: "wx", mode: 0o644 }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "EEXIST") throw e
  })
  return name
}
