"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, RotateCcw } from "lucide-react";
import { call } from "@/lib/client-api";
import { useT } from "./i18n";
import { useConfirm } from "./confirm";

export function DeleteButton({ slug, title }: { slug: string; title: string }) {
  const t = useT();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [dialog, confirm] = useConfirm();
  return (
    <>
      {dialog}
      <button
        type="button"
        className="btn danger sm"
        onClick={async () => {
          if (
            !(await confirm({
              title: t("Move page to the trash?"),
              body: t(
                "“{title}” and its whole history go to the trash, where editors can restore it for 30 days. Pages inside it move to the top level until then.",
                { title },
              ),
              confirmLabel: t("Move to trash"),
              danger: true,
            }))
          )
            return;
          const r = await call(`/api/pages/${slug}`, "DELETE");
          if (r.ok) {
            router.push("/");
            router.refresh();
          } else setErr(t(r.data.error ?? "Couldn’t delete."));
        }}
      >
        <Trash2 size={15} aria-hidden />
        {t("Delete")}
      </button>
      {err && (
        <span className="error-text" role="alert">
          {err}
        </span>
      )}
    </>
  );
}

/**
 * Puts version `rev` back as a new version on top — on the server, so nothing has to round-trip
 * through the browser and the history records which version it came from.
 */
export function RestoreVersionButton({
  slug,
  rev,
  currentRev,
  compact,
}: {
  slug: string;
  rev: number;
  currentRev: number;
  compact?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, confirm] = useConfirm();
  const label = t("Restore version {n}", { n: rev });
  return (
    <>
      {dialog}
      <button
        type="button"
        className={compact ? "icon-btn plain" : "btn sm"}
        title={compact ? label : undefined}
        aria-label={compact ? label : undefined}
        disabled={busy}
        onClick={async () => {
          if (
            !(await confirm({
              title: t("Restore version {n}?", { n: rev }),
              body: t(
                "Title and text of version {n} become the current version {m}. Nothing is lost: the version you replace stays in the history and can be restored the same way.",
                { n: rev, m: currentRev + 1 },
              ),
              confirmLabel: t("Restore"),
            }))
          )
            return;
          setBusy(true);
          const r = await call<{ slug: string }>(`/api/pages/${slug}/restore`, "POST", {
            rev,
            expectedRev: currentRev,
          });
          setBusy(false);
          if (r.ok) {
            router.push(`/w/${slug}`);
            router.refresh();
          } else setErr(t(r.data.error ?? "Couldn’t restore."));
        }}
      >
        <RotateCcw size={15} aria-hidden />
        {!compact && t("Restore this version")}
      </button>
      {err && (
        <span className="error-text" role="alert">
          {err}
        </span>
      )}
    </>
  );
}
