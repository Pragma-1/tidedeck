import "./setup-env";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, safeEqual, sha256 } from "@/lib/crypto";
import { base32Decode, base32Encode, hotp, verifyTotp } from "@/lib/totp";
import { countClasses, policyChecks, type PasswordPolicy } from "@/lib/password-policy";
import { checkPasswordStrength, hashPassword, needsRehash, verifyPassword } from "@/lib/password";
import { isSameOrigin, clientIp, hostAllowed } from "@/lib/net";
import { slugify } from "@/lib/validate";

describe("AES-256-GCM", () => {
  it("round-trips and binds to AAD", () => {
    const c = encrypt("secret-value", "user:1:totp");
    expect(c).not.toContain("secret-value");
    expect(decrypt(c, "user:1:totp")).toBe("secret-value");
    expect(() => decrypt(c, "user:2:totp")).toThrow();
  });
  it("detects tampering", () => {
    const [v, iv, ct, tag] = encrypt("abc", "x").split(".");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 1;
    expect(() => decrypt([v, iv, flipped.toString("base64url"), tag].join("."), "x")).toThrow();
    expect(() => decrypt("garbage", "x")).toThrow();
  });
  it("uses a fresh IV every time", () => expect(encrypt("a", "x")).not.toBe(encrypt("a", "x")));
  it("safeEqual", () => {
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "b")).toBe(false);
    expect(safeEqual("a", "aa")).toBe(false);
  });
  it("sha256 known vector", () =>
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
});

describe("TOTP (RFC 6238 vectors, SHA-1)", () => {
  const secret = Buffer.from("12345678901234567890");
  it("base32 round-trip", () => expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true));
  // RFC 6238 appendix B, 8 digits
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ];
  for (const [t, code] of vectors) {
    it(`t=${t}`, () => expect(hotp(secret, Math.floor(t / 30), 8)).toBe(code));
  }
  it("accepts ±1 step, rejects ±2 and replays", () => {
    const b32 = base32Encode(secret);
    const now = 1_700_000_000_000;
    const at = (d: number) => hotp(secret, Math.floor(now / 30000) + d);
    expect(verifyTotp(b32, at(0), now)).toBe(Math.floor(now / 30000));
    expect(verifyTotp(b32, at(-1), now)).not.toBeNull();
    expect(verifyTotp(b32, at(1), now)).not.toBeNull();
    expect(verifyTotp(b32, at(2), now)).toBeNull();
    expect(verifyTotp(b32, at(-2), now)).toBeNull();
    expect(verifyTotp(b32, at(0), now, Math.floor(now / 30000))).toBeNull(); // replay
    expect(verifyTotp(b32, "12345", now)).toBeNull();
    expect(verifyTotp(b32, "abcdef", now)).toBeNull();
  });
});

describe("passwords", () => {
  it("argon2id hash verifies, differs per call, wrong password fails", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("$argon2id$v=19$m=65536,t=3,p=1$")).toBe(true);
    expect(await verifyPassword(h, "correct horse battery")).toBe(true);
    expect(await verifyPassword(h, "correct horse batterY")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
    expect(h).not.toBe(await hashPassword("correct horse battery"));
    expect(needsRehash(h)).toBe(false);
    expect(needsRehash("$argon2id$v=19$m=4096,t=1,p=1$abc$def")).toBe(true);
  });
  it("strength rules", () => {
    const P = (minLength = 12, o: Partial<PasswordPolicy> = {}): PasswordPolicy => ({
      minLength,
      digits: 0,
      special: 0,
      upper: 0,
      lower: 0,
      ...o,
    });
    expect(checkPasswordStrength("short", P())).toMatch(/at least 12/);
    expect(checkPasswordStrength("passwordpassword", P())).toMatch(/common/);
    expect(checkPasswordStrength("alfons-is-great-123", P(), { username: "alfons" })).toMatch(/username/);
    expect(checkPasswordStrength("x".repeat(300), P())).toMatch(/too long/);
    expect(checkPasswordStrength("tidal-marsh-lantern-47", P(), { username: "alfons" })).toBeNull();
    // composition rules
    expect(checkPasswordStrength("tidal-marsh-lantern", P(12, { digits: 2 }))).toMatch(/2 digit/);
    expect(checkPasswordStrength("tidal-marsh-lantern-47", P(12, { digits: 2 }))).toBeNull();
    expect(checkPasswordStrength("tidalmarshlantern47", P(12, { special: 1 }))).toMatch(/special/);
    expect(checkPasswordStrength("tidal-marsh-lantern-47", P(12, { upper: 1 }))).toMatch(/upper-case/);
    expect(
      checkPasswordStrength("Tidal-Marsh-Lantern-47", P(12, { upper: 2, lower: 5, digits: 2, special: 3 })),
    ).toBeNull();
    expect(checkPasswordStrength("TIDAL-MARSH-LANTERN-47", P(12, { lower: 1 }))).toMatch(/lower-case/);
    // Unicode-aware: umlauts are letters, spaces are not special characters
    expect(countClasses("Ärger über Öl 4!")).toEqual({ length: 16, digits: 1, special: 1, upper: 2, lower: 9 });
    expect(policyChecks("abc", P(10, { digits: 1 })).map((c) => c.ok)).toEqual([false, false]);
    expect(policyChecks("abc", P(10)).map((c) => c.id)).toEqual(["length"]); // rules set to 0 are not listed
  });
});

describe("CSRF origin check", () => {
  const base = "https://wiki.example.com";
  it("allows same origin / same host", () => {
    expect(isSameOrigin({ origin: base, secFetchSite: "same-origin", host: "wiki.example.com", baseUrl: base })).toBe(
      true,
    );
    expect(
      isSameOrigin({ origin: "http://192.168.1.5:3000", secFetchSite: null, host: "192.168.1.5:3000", baseUrl: base }),
    ).toBe(true);
  });
  it("blocks cross-site, missing, null, and malformed origins", () => {
    expect(
      isSameOrigin({ origin: "https://evil.com", secFetchSite: "cross-site", host: "wiki.example.com", baseUrl: base }),
    ).toBe(false);
    expect(
      isSameOrigin({ origin: "https://evil.com", secFetchSite: null, host: "wiki.example.com", baseUrl: base }),
    ).toBe(false);
    expect(isSameOrigin({ origin: null, secFetchSite: null, host: "wiki.example.com", baseUrl: base })).toBe(false);
    expect(isSameOrigin({ origin: "null", secFetchSite: null, host: "wiki.example.com", baseUrl: base })).toBe(false);
    expect(isSameOrigin({ origin: "javascript:alert(1)", secFetchSite: null, host: "x", baseUrl: base })).toBe(false);
    expect(
      isSameOrigin({
        origin: "https://wiki.example.com.evil.com",
        secFetchSite: null,
        host: "wiki.example.com",
        baseUrl: base,
      }),
    ).toBe(false);
  });
});

describe("DNS rebinding / Host allow-list", () => {
  const base = "http://localhost:3000";
  it("accepts IP literals, localhost, the base host and listed hosts", () => {
    expect(hostAllowed("10.0.2.5:3003", base)).toBe(true);
    expect(hostAllowed("[::1]:3000", base)).toBe(true);
    expect(hostAllowed("localhost:3003", base)).toBe(true);
    expect(hostAllowed("wiki.example.com", "https://wiki.example.com")).toBe(true);
    expect(hostAllowed("wiki.lan:3003", base, ["wiki.lan"])).toBe(true);
  });
  it("rejects attacker-controlled names even when Origin matches Host", () => {
    expect(hostAllowed("evil.example:3003", base)).toBe(false);
    expect(hostAllowed("10.0.2.5.evil.example", base)).toBe(false);
    expect(hostAllowed("", base)).toBe(false);
    expect(hostAllowed("a b", base)).toBe(false);
    expect(
      isSameOrigin({
        origin: "http://evil.example:3003",
        secFetchSite: "same-origin",
        host: "evil.example:3003",
        baseUrl: base,
      }),
    ).toBe(false);
    expect(
      isSameOrigin({
        origin: "http://10.0.2.5:3003",
        secFetchSite: "same-origin",
        host: "10.0.2.5:3003",
        baseUrl: base,
      }),
    ).toBe(true);
    expect(
      isSameOrigin({ origin: "http://wiki.lan:3003", secFetchSite: null, host: "wiki.lan:3003", baseUrl: base }),
    ).toBe(false);
    expect(
      isSameOrigin({
        origin: "http://wiki.lan:3003",
        secFetchSite: null,
        host: "wiki.lan:3003",
        baseUrl: base,
        allowedHosts: ["wiki.lan"],
      }),
    ).toBe(true);
  });
});

describe("client IP", () => {
  it("ignores forwarded headers without trusted proxy", () =>
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4" }), 0)).toBeNull());
  it("takes the Nth entry from the right (spoof-resistant)", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), 1)).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-forwarded-for": "garbage" }), 1)).toBeNull();
  });
});

describe("slugify", () => {
  it("normalises", () => {
    expect(slugify("Größe & Übung!")).toBe("grosse-ubung");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("***")).toBe("page");
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});
