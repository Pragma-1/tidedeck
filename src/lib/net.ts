import { isIP } from "node:net";
import { TRUSTED_PROXY_HOPS } from "./config";

/**
 * Client IP, only when we know how many trusted proxies sit in front of us.
 * With N hops we take the Nth entry from the right of X-Forwarded-For — everything left of
 * that is attacker-controlled. Returns null when forwarded headers must not be trusted.
 */
export function clientIp(headers: Headers, hops = TRUSTED_PROXY_HOPS): string | null {
  if (hops <= 0) return null;
  const parts = (headers.get("x-forwarded-for") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidate = parts[parts.length - hops];
  return candidate && isIP(candidate) ? candidate : null;
}

/**
 * Is this Host header one we expect? An IP literal or "localhost" can't be a DNS-rebinding
 * target (the attacker can't make a browser send those as Host for a page they control), and
 * a named host must be the one configured in WIKI_BASE_URL (or listed in WIKI_ALLOWED_HOSTS).
 */
export function hostAllowed(host: string | null, baseUrl: string, allowedHosts: string[] = []): boolean {
  if (!host) return false;
  let u: URL;
  try {
    u = new URL(`http://${host}`);
  } catch {
    return false;
  }
  const name = u.hostname.toLowerCase(); // IPv6 literals keep their [brackets]
  if (name === "localhost" || isIP(name.replace(/^\[|\]$/g, "")) !== 0) return true;
  if (u.host === new URL(baseUrl).host.toLowerCase()) return true;
  return allowedHosts.includes(name) || allowedHosts.includes(u.host.toLowerCase());
}

/** CSRF defence: state-changing requests must come from our own origin. */
export function isSameOrigin(opts: {
  origin: string | null;
  secFetchSite: string | null;
  host: string | null;
  baseUrl: string;
  allowedHosts?: string[];
}): boolean {
  const { origin, secFetchSite, host, baseUrl, allowedHosts } = opts;
  if (secFetchSite === "cross-site") return false;
  if (!origin || origin === "null") return false;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.protocol !== "http:" && o.protocol !== "https:") return false;
  if (o.origin === new URL(baseUrl).origin) return true;
  // Otherwise the page must have been loaded from the very host it is posting to, and that
  // host must be one of ours (stops DNS-rebinding pages on attacker-controlled names).
  return !!host && o.host.toLowerCase() === host.toLowerCase() && hostAllowed(host, baseUrl, allowedHosts);
}
