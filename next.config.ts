import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // API answers are data, never pages: nothing in them may run or be framed,
        // even if an upstream (music server, feed) sends HTML.
        source: "/api/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; sandbox" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ]
  },
}

export default nextConfig
