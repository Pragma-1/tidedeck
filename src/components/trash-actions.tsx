"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { call } from "@/lib/client-api";
import { useT } from "./i18n";
import { useConfirm } from "./confirm";
import { useToast } from "./ui";

export function TrashRestoreButton({ id, title, compact }: { id: number; title: string; compact?: boolean }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const label = t("Restore “{title}”", { title });
  return (
    <>
      {toast.node}
      <button
        type="button"
        className={compact ? "btn ghost sm" : "btn sm"}
        aria-label={compact ? label : undefined}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await call<{ slug: string; slugChanged: boolean }>(`/api/trash/${id}/restore`, "POST");
          setBusy(false);
          if (!r.ok) {
            toast.show({ ok: false, text: t(r.data.error ?? "Couldn’t restore.") });
            return;
          }
          // a different address (old one taken meanwhile) is visible in the URL bar and noted on the page
          router.push(`/w/${r.data.slug}${r.data.slugChanged ? "?moved=1" : ""}`);
          router.refresh();
        }}
      >
        <RotateCcw size={15} aria-hidden />
        {t("Restore")}
      </button>
    </>
  );
}

/** Admins only: delete one page for good, or the whole trash. */
export function TrashPurgeButton({ id, title, back }: { id?: number; title?: string; back?: boolean }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [dialog, confirm] = useConfirm();
  const all = id === undefined;
  return (
    <>
      {dialog}
      {toast.node}
      <button
        type="button"
        className="btn danger sm"
        onClick={async () => {
          if (
            !(await confirm(
              all
                ? {
                    title: t("Empty the trash?"),
                    body: t(
                      "All pages in the trash and their histories are deleted for good. Backups made before keep them until they expire.",
                    ),
                    confirmLabel: t("Empty trash"),
                    danger: true,
                    typeToConfirm: t("empty"),
                  }
                : {
                    title: t("Delete permanently?"),
                    body: t(
                      "“{title}” and its whole history are deleted for good. Backups made before keep it until they expire.",
                      { title: title ?? "" },
                    ),
                    confirmLabel: t("Delete permanently"),
                    danger: true,
                  },
            ))
          )
            return;
          const r = await call(all ? "/api/trash" : `/api/trash/${id}`, "DELETE");
          if (!r.ok) {
            toast.show({ ok: false, text: t(r.data.error ?? "Couldn’t delete.") });
            return;
          }
          if (back) router.push("/trash");
          router.refresh();
        }}
      >
        <Trash2 size={15} aria-hidden />
        {all ? t("Empty trash") : t("Delete permanently")}
      </button>
    </>
  );
}
