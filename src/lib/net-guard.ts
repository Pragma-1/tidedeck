import { isIP } from "node:net";

/**
 * Addresses outgoing connections configured in the settings (SMTP, S3) must never reach:
 * unspecified, link-local (cloud metadata endpoints such as 169.254.169.254) and multicast.
 * Private LAN addresses stay allowed on purpose: a self-hosted mail server or MinIO lives there.
 */
export function forbiddenAddress(ip: string): boolean {
  const v4 = ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || (a === 169 && b === 254) || a >= 224;
  }
  const l = ip.toLowerCase();
  return l === "::" || /^fe[89ab]/.test(l) || l.startsWith("ff") || /^fd00:ec2::/.test(l);
}
