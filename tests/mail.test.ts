import "./setup-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { db } from "./pg";
import { getSettings, updateSettings } from "@/lib/settings";
import { hasSmtpPassword, isMailConfigured, mailErrorReason, mailSource, sendMail, setSmtpPassword } from "@/lib/mail";
import { renderMail } from "@/lib/mail-template";

/** Minimal SMTP server (plain, no auth) that records what it receives. */
function fakeSmtp(port: number) {
  const received: string[] = [];
  const server: Server = createServer((sock) => {
    let data = false,
      buf = "";
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0 || (data && buf.includes("\r\n.\r\n"))) {
        if (data) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) break;
          received.push(buf.slice(0, end));
          buf = buf.slice(end + 5);
          data = false;
          sock.write("250 queued\r\n");
          continue;
        }
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") sock.write("250-fake\r\n250 8BITMIME\r\n");
        else if (cmd === "HELO") sock.write("250 fake\r\n");
        else if (cmd === "DATA") {
          data = true;
          sock.write("354 go\r\n");
        } else if (cmd === "QUIT") {
          sock.write("221 bye\r\n");
          sock.end();
        } else sock.write("250 ok\r\n");
      }
    });
  });
  return {
    received,
    start: () => new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r())),
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("mail template", () => {
  it("escapes every value and only allows http(s) links", async () => {
    const m = renderMail({
      site: `<script>alert(1)</script>`,
      heading: `"><img src=x onerror=alert(1)>`,
      paragraphs: ["a & b <b>"],
      facts: [["<k>", "<v>"]],
      button: { label: "<go>", url: "javascript:alert(1)" },
      linkFallback: "fallback",
      footer: "<f>",
    });
    expect(m.html).not.toMatch(/<script|<img|<b>|<k>|<v>|<go>|<f>/);
    expect(m.html).not.toContain("javascript:");
    expect(m.html).not.toContain("&lt;go&gt;"); // the unsafe button is dropped entirely
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.text).toContain("a & b <b>"); // text part is plain text, nothing to escape
    const ok = renderMail({
      site: "W",
      heading: "H",
      paragraphs: [],
      button: { label: "Go", url: "https://wiki.example/reset#token=abc" },
      footer: "F",
    });
    expect(ok.html).toContain('href="https://wiki.example/reset#token=abc"');
    expect(ok.html).toMatch(/font-family:Inter/);
  });
});

describe("SMTP from the settings page", () => {
  const smtp = fakeSmtp(2525);
  beforeAll(() => smtp.start());
  afterAll(() => smtp.stop());

  it("is not configured until host and sender are set", async () => {
    expect(await isMailConfigured()).toBe(false);
    expect(await mailSource()).toBe("none");
    await updateSettings({ smtp_host: "127.0.0.1", smtp_port: 2525, smtp_security: "none" });
    expect(await isMailConfigured()).toBe(false); // no sender yet
    await updateSettings({ smtp_from: "wiki@example.org" });
    expect(await isMailConfigured()).toBe(true);
    expect(await mailSource()).toBe("settings");
  });

  it("stores the password encrypted and never in the regular settings", async () => {
    await setSmtpPassword("S3cret-smtp-pass");
    expect(await hasSmtpPassword()).toBe(true);
    const raw = (
      (await db().prepare("SELECT value FROM settings WHERE key='smtp_password_enc'").get()) as { value: string }
    ).value;
    expect(raw).not.toContain("S3cret");
    expect(JSON.stringify(await getSettings())).not.toContain("S3cret");
    expect(await updateSettings({ smtp_password_enc: "x" } as never)).toMatchObject({ ok: false }); // not writable through settings
    await setSmtpPassword(null);
    expect(await hasSmtpPassword()).toBe(false);
  });

  it("sends a multipart mail with the HTML design and a text part; header injection is impossible", async () => {
    const m = renderMail({ site: "Tidewiki", heading: "Test", paragraphs: ["Hallo"], footer: "Fuß" });
    await sendMail("admin@example.org", "Betreff\r\nBcc: victim@example.org", m.text, m.html);
    expect(smtp.received).toHaveLength(1);
    const raw = smtp.received[0];
    expect(raw).toMatch(/Content-Type: multipart\/alternative/i);
    expect(raw).toMatch(/text\/plain/i);
    expect(raw).toMatch(/text\/html/i);
    expect(raw).not.toMatch(/^Bcc:/im);
    expect(raw).toMatch(/^From: Tidewiki <wiki@example\.org>/m);
  });

  it("refuses ports that aren't mail ports and link-local / metadata addresses", async () => {
    await updateSettings({ smtp_port: 6379 });
    await expect(sendMail("a@example.org", "s", "t")).rejects.toThrow(/port is not allowed/);
    await updateSettings({ smtp_port: 587, smtp_host: "169.254.169.254" });
    await expect(sendMail("a@example.org", "s", "t")).rejects.toThrow(/address is not allowed/);
    await updateSettings({ smtp_host: "0.0.0.0" });
    await expect(sendMail("a@example.org", "s", "t")).rejects.toThrow(/address is not allowed/);
    await updateSettings({ smtp_host: "no-such-host.invalid" });
    await expect(sendMail("a@example.org", "s", "t")).rejects.toThrow(/could not be resolved/);
    await updateSettings({ smtp_host: "127.0.0.1", smtp_port: 2525 });
  });

  it("turns SMTP errors into one short, single-line reason", async () => {
    const e = Object.assign(new Error("Invalid login:\r\n535 5.7.8 nope " + "x".repeat(500)), { code: "EAUTH" });
    const r = mailErrorReason(e);
    expect(r).not.toMatch(/[\r\n]/);
    expect(r.length).toBeLessThanOrEqual(240);
    expect(r).toMatch(/^EAUTH Invalid login/);
  });
});
