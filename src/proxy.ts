import { NextRequest, NextResponse } from "next/server";

const SECURE = (process.env.WIKI_BASE_URL || "").startsWith("https://");

/** Per-request CSP nonce + hardening headers for every page and API response. */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'", // inline style attributes only (table alignment); scripts stay strict
    "img-src 'self' data: https:", // https: is only used after a reader clicks "load image" (or if autoload is on)
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' https:", // video only: no autoplay (Permissions-Policy below), preload="none"
    "frame-src https://www.youtube-nocookie.com https://player.vimeo.com", // only after a click (two-click embeds)
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(SECURE ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), autoplay=(), payment=(), usb=()");
  if (SECURE) res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|media/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
