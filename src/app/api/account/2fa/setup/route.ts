import QRCode from "qrcode";
import { api, json } from "@/lib/api";
import { beginTotpSetup } from "@/lib/auth";
import { str } from "@/lib/validate";
export const dynamic = "force-dynamic";

export const POST = api(
  "user",
  async ({ body, user }) => {
    const b = await body();
    const { secret, uri } = await beginTotpSetup(user!, str(b.password, "Password", { max: 256, trim: false }));
    const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return json({ secret, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` });
  },
  { allowPending2fa: true },
);
