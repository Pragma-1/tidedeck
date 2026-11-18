/**
 * After an update (a new image), a tab that was already open still runs the old
 * scripts, and the parts it loads later (editor, dialogs …) no longer exist on
 * the server under their old names. Such a tab reloads itself:
 *
 * - right away, when loading one of those parts fails (and comes back in edit
 *   mode if that's what you were opening);
 * - at a quiet moment, when live sync reports that the server runs a newer
 *   build (see use-sync.ts).
 *
 * A guard stops reload loops: at most one automatic reload per 30 seconds.
 */
// The build this page came with (from the server, with the page; "dev" if unknown).
let pageBuild = "dev"
export const setPageBuild = (id: string) => void (pageBuild = id)
export const getPageBuild = () => pageBuild

const RELOADED = "tidedeck:reloaded"
const RESUME_EDIT = "tidedeck:resume-edit"
const RELOADED_FOR = "tidedeck:reloaded-for"

/** A failed download of a script part (old or missing file, network gone). */
export function isChunkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { name?: unknown; message?: unknown }
  const text = `${String(e.name ?? "")} ${String(e.message ?? "")}`
  return /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed|Failed to fetch dynamically|error loading dynamically|Unable to preload CSS/i.test(text)
}

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Reloads the page once (not again within 30 s, and only once for a given newer
 * build); returns false if it doesn't.
 */
export function reloadForUpdate(opts: { resumeEdit?: boolean; build?: string } = {}): boolean {
  if (typeof window === "undefined") return false
  // Offline, a reload would only show the browser's error page instead of the dashboard.
  if (navigator.onLine === false) return false
  const s = storage()
  const last = Number(s?.getItem(RELOADED) ?? 0)
  if (Date.now() - last < 30_000) return false
  if (opts.build) {
    if (s?.getItem(RELOADED_FOR) === opts.build) return false
    s?.setItem(RELOADED_FOR, opts.build)
  }
  s?.setItem(RELOADED, String(Date.now()))
  if (opts.resumeEdit) s?.setItem(RESUME_EDIT, "1")
  window.location.reload()
  return true
}

/** After such a reload: should edit mode open again? (Asks once.) */
export function takeResumeEdit(): boolean {
  const s = storage()
  if (s?.getItem(RESUME_EDIT) !== "1") return false
  s.removeItem(RESUME_EDIT)
  return true
}

/**
 * Wraps a lazy import: if the part can't be loaded because the page is out of
 * date, the page reloads (the promise then never settles); other failures are
 * passed on.
 */
export function loadPart<T>(load: () => Promise<T>, opts: { resumeEdit?: boolean } = {}): () => Promise<T> {
  return () =>
    load().catch((err: unknown) => {
      if (isChunkError(err) && reloadForUpdate(opts)) return new Promise<T>(() => {})
      throw err
    })
}
