import { api, json } from "@/lib/api";
import { requestPasswordReset } from "@/lib/auth";
import { str } from "@/lib/validate";
export const dynamic = "force-dynamic";

export const POST = api("public", async ({ body, ip, t, lang }) => {
  const b = await body();
  const email = str(b.email, "E-mail", { max: 254 });
  // Identical answer whether or not the address exists; sending happens in the background.
  void requestPasswordReset(email, ip, lang).catch((e: unknown) =>
    console.error("[reset] failed:", e instanceof Error ? e.message : "unknown"),
  );
  return json({
    ok: true,
    message: t("If that address belongs to an account, a reset link is on its way. It works for 30 minutes."),
  });
});
