import { NextResponse, type NextRequest } from "next/server"

/**
 * Content-Security-Policy with a fresh nonce per page view. Scripts only run
 * when they carry the nonce (Next.js adds it to its own), so injected markup
 * can't execute code. The other directives allow exactly what the dashboard
 * uses: images from anywhere (app icons, favicons on the LAN), embedded pages
 * and players, weather and icon-list lookups.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const dev = process.env.NODE_ENV === "development"
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline styles are needed for layout positions and the live theme; they can't run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http: https:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self' https://geocoding-api.open-meteo.com https://raw.githubusercontent.com https://cdn.jsdelivr.net",
    "frame-src http: https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ")

  const headers = new Headers(request.headers)
  headers.set("x-nonce", nonce)
  headers.set("Content-Security-Policy", csp)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set("Content-Security-Policy", csp)
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin")
  return response
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
}
