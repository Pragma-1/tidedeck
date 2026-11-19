import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { waitForDrain } from "@/lib/stream-util";

/** A slow sink with a tiny buffer, so almost every write hits backpressure. */
const slowSink = () =>
  new Writable({
    highWaterMark: 4,
    write(_chunk, _enc, cb) {
      setImmediate(cb);
    },
  });

describe("waitForDrain", () => {
  it("leaves no listeners behind, however many backpressure cycles a write goes through", async () => {
    const out = slowSink();
    const baseError = out.listenerCount("error"),
      baseDrain = out.listenerCount("drain");
    let waits = 0;
    for (let i = 0; i < 500; i++) {
      if (!out.write(Buffer.alloc(64))) {
        await waitForDrain(out);
        waits++;
      }
    }
    expect(waits).toBeGreaterThan(100); // the test really exercised backpressure
    expect(out.listenerCount("error")).toBe(baseError);
    expect(out.listenerCount("drain")).toBe(baseDrain);
    await new Promise<void>((r) => out.end(r));
  });

  it("also resolves (and cleans up) when the stream fails instead of draining", async () => {
    const out = slowSink();
    out.on("error", () => {}); // the caller's own handler, as in media.ts / transfer.ts
    out.write(Buffer.alloc(64));
    const p = waitForDrain(out);
    out.destroy(new Error("disk full"));
    await p;
    expect(out.listenerCount("drain")).toBe(0);
    expect(out.listenerCount("error")).toBe(1); // only the caller's handler remains
  });
});
