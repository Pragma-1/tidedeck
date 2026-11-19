"use client";
import { useEffect } from "react";
import { safeUrl, VIMEO_ID, YT_ID } from "@/lib/embed-url";
import { useT } from "./i18n";
import type { T } from "@/lib/i18n";

/**
 * Two-click embeds: the server only renders a placeholder. Nothing is requested from YouTube,
 * Vimeo or a foreign image host until the reader clicks. Elements are built with DOM APIs from
 * re-validated values — no HTML strings, so a crafted data-* attribute can't inject markup.
 */
function activate(box: HTMLElement, t: T) {
  const kind = box.dataset.embed;
  let el: HTMLElement | null = null;
  if (kind === "youtube" && YT_ID.test(box.dataset.id ?? "")) {
    el = frame(`https://www.youtube-nocookie.com/embed/${box.dataset.id}`);
  } else if (kind === "vimeo" && VIMEO_ID.test(box.dataset.id ?? "")) {
    el = frame(`https://player.vimeo.com/video/${box.dataset.id}?dnt=1`);
  } else if (kind === "image") {
    const u = safeUrl(box.dataset.src ?? "");
    if (u && u.protocol === "https:") {
      const img = document.createElement("img");
      img.src = u.href;
      img.alt = box.dataset.alt ?? "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      el = img;
    }
  }
  if (!el) return;
  const nodes: Node[] = [el];
  if (kind === "youtube" || kind === "vimeo") {
    // keep the "open on …" link (it opens in a new tab) and add the picture-in-picture toggle
    const tools = document.createElement("div");
    tools.className = "media-tools";
    tools.append(pipButton(t));
    const open = box.querySelector<HTMLAnchorElement>("a.embed-open");
    if (open) tools.append(open);
    nodes.push(tools);
  }
  box.replaceChildren(...nodes);
  box.classList.add("embed-active");
}

function frame(src: string) {
  const f = document.createElement("iframe");
  f.src = src;
  f.title = "Video";
  // no autoplay (also blocked by Permissions-Policy): the reader starts playback in the player
  f.allow = "encrypted-media; picture-in-picture; fullscreen";
  f.allowFullscreen = true;
  // YouTube refuses to play without a Referer; send only our origin, never the page path.
  f.referrerPolicy = "strict-origin-when-cross-origin";
  f.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox",
  );
  return f;
}

function pipButton(t: T) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pip-btn";
  b.textContent = t("Picture-in-picture");
  return b;
}

/* --------------------------------------------------- picture-in-picture */

/**
 * Native picture-in-picture where the browser offers it for <video>; otherwise (and always for
 * YouTube/Vimeo iframes, which can't be pulled out of the page) a mini player pinned to the
 * corner of the window. Pinning only changes CSS — the player is never moved in the DOM, so
 * playback continues without reloading. A placeholder keeps the page from jumping.
 */
function unpin(box: HTMLElement, t: T) {
  box.classList.remove("floating");
  const ph = box.previousElementSibling;
  if (ph?.classList.contains("float-ph")) ph.remove();
  const btn = box.querySelector<HTMLButtonElement>(".pip-btn");
  if (btn) {
    btn.textContent = t("Picture-in-picture");
    btn.setAttribute("aria-pressed", "false");
  }
}

function pin(box: HTMLElement, t: T) {
  document.querySelectorAll<HTMLElement>(".md .floating").forEach((b) => unpin(b, t)); // one mini player at a time
  const ph = document.createElement("div");
  ph.className = "float-ph";
  ph.style.height = `${box.offsetHeight}px`;
  ph.setAttribute("aria-hidden", "true");
  box.before(ph);
  box.classList.add("floating");
  const btn = box.querySelector<HTMLButtonElement>(".pip-btn");
  if (btn) {
    btn.textContent = t("Back into the page");
    btn.setAttribute("aria-pressed", "true");
  }
}

async function togglePip(btn: HTMLElement, t: T) {
  const box = btn.closest<HTMLElement>(".media-video, .embed");
  if (!box) return;
  if (box.classList.contains("floating")) {
    unpin(box, t);
    return;
  }
  const video = box.querySelector("video");
  if (video && document.pictureInPictureEnabled && !video.disablePictureInPicture) {
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
        return;
      }
      if (video.readyState === 0) {
        video.preload = "metadata";
        const ready = new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
        video.load();
        await ready;
      }
      await video.requestPictureInPicture();
      return;
    } catch {
      /* fall back to the mini player */
    }
  }
  pin(box, t);
}

export function EmbedActivator() {
  const t = useT();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const copy = target?.closest?.(".md .copy-code") as HTMLButtonElement | null;
      if (copy) {
        const code = copy.parentElement?.querySelector("code")?.textContent ?? "";
        void navigator.clipboard?.writeText(code).then(() => {
          copy.dataset.done = "1";
          setTimeout(() => {
            delete copy.dataset.done;
          }, 1500);
        });
        return;
      }
      const pipBtn = target?.closest?.(".md .pip-btn") as HTMLElement | null;
      if (pipBtn) {
        e.preventDefault();
        void togglePip(pipBtn, t);
        return;
      }
      const btn = target?.closest?.(".md .embed-load");
      const box = btn?.closest<HTMLElement>(".embed");
      if (box) {
        e.preventDefault();
        activate(box, t);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      document.querySelectorAll<HTMLElement>(".md .floating").forEach((b) => unpin(b, t));
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [t]);
  return null;
}
