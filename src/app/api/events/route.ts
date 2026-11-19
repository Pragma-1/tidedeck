import { api } from "@/lib/api";
import { addClient, clientCount, removeClient, subscribe } from "@/lib/events";
import { LIMITS } from "@/lib/config";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

// Server-Sent Events: pushes "page created/updated/deleted" so open pages refresh live.
const perIp = new Map<string, number>();

export const GET = api(
  "public",
  async ({ req, ip }) => {
    if (clientCount() >= LIMITS.maxSseClients) throw new HttpError(503, "Too many live connections.");
    if (ip && (perIp.get(ip) ?? 0) >= 12) throw new HttpError(429, "Too many live connections.");
    if (ip) perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const enc = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(controller) {
        addClient();
        const send = (s: string) => {
          try {
            controller.enqueue(enc.encode(s));
          } catch {
            cleanup();
          }
        };
        const off = subscribe((e) => send(`event: wiki\ndata: ${JSON.stringify(e)}\n\n`));
        const beat = setInterval(() => send(": keep-alive\n\n"), 25_000);
        let done = false;
        cleanup = () => {
          if (done) return;
          done = true;
          clearInterval(beat);
          off();
          removeClient();
          if (ip) {
            const n = (perIp.get(ip) ?? 1) - 1;
            if (n > 0) perIp.set(ip, n);
            else perIp.delete(ip);
          }
          try {
            controller.close();
          } catch {
            /* closed */
          }
        };
        req.signal.addEventListener("abort", cleanup);
        send("retry: 3000\n\n: connected\n\n");
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  },
  { readGate: true },
);
