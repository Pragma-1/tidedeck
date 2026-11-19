import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // No image optimizer: the app never uses next/image, so the native libvips decoder (sharp)
  // is switched off and kept out of the build instead of sitting there as attack surface.
  images: { unoptimized: true },
  outputFileTracingExcludes: { "*": ["node_modules/sharp/**", "node_modules/@img/**"] },
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2"],
  async headers() {
    return [{ source: "/_next/static/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] }];
  },
  experimental: { serverActions: { bodySizeLimit: "100kb" } },
};

export default config;
