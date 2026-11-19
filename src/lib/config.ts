// Central runtime configuration. Everything comes from environment variables
// (docker.yaml -> .env), so no secret ever needs to live in a file you commit.
// Blank values (e.g. "SMTP_USER=" in a .env file) are treated as "not set".
export const DATA_DIR = process.env.WIKI_DATA_DIR || "/data";
export const BASE_URL = (process.env.WIKI_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
export const SECURE_COOKIES = BASE_URL.startsWith("https://");
// Number of reverse proxies in front of the app that append to X-Forwarded-For.
// 0 = do not trust forwarded headers at all (safe default for direct exposure).
export const TRUSTED_PROXY_HOPS = Math.max(
  0,
  Math.min(5, Number.parseInt(process.env.WIKI_TRUSTED_PROXY_HOPS || "0", 10) || 0),
);
// Extra host names the wiki may be reached under (comma separated), besides WIKI_BASE_URL's host,
// IP addresses and localhost. Only needed for a second domain name pointing at the same wiki.
export const ALLOWED_HOSTS = (process.env.WIKI_ALLOWED_HOSTS || "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
export const ISSUER = "Tidewiki";

export const LIMITS = {
  pageBytes: 512 * 1024,
  titleChars: 120,
  jsonBytes: 16 * 1024,
  maxSseClients: 300,
  maxPageDepth: 3,
};
