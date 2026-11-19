/** Node-only. A stray rejected promise must never take the whole wiki down (Node's default is to exit). */
let installed = false;
export function installSafetyNet() {
  if (installed) return;
  installed = true;
  process.on("unhandledRejection", (e) =>
    console.error("[tidewiki] unhandled rejection:", e instanceof Error ? e.message : e),
  );
}
