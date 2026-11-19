import type { Writable } from "node:stream";

/**
 * Waits until a writable stream accepts data again ("drain") or fails ("error"), then removes
 * BOTH listeners. Registering two `once` listeners leaves the one that didn't fire attached, which
 * leaks one listener per backpressure cycle — thousands on a large upload or import.
 */
export function waitForDrain(out: Writable): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      out.off("drain", done);
      out.off("error", done);
      resolve();
    };
    out.on("drain", done);
    out.on("error", done);
  });
}
