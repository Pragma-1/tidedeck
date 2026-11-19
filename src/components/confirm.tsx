"use client";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useT } from "./i18n";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** When set, the person has to type this text before the confirm button unlocks. */
  typeToConfirm?: string;
};

/**
 * Styled, accessible replacement for window.confirm(): a native modal <dialog> (focus trap, Esc,
 * inert background for free). Usage: const [dialog, confirm] = useConfirm(); … {dialog} …
 * if (!(await confirm({ … }))) return;
 */
export function useConfirm(): [ReactNode, (o: ConfirmOptions) => Promise<boolean>] {
  const t = useT();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState("");

  const finish = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    if (ref.current?.open) ref.current.close();
    setOpts(null);
    setTyped("");
  }, []);

  useEffect(() => {
    if (opts && ref.current && !ref.current.open) ref.current.showModal();
  }, [opts]);
  useEffect(
    () => () => {
      resolver.current?.(false);
    },
    [],
  );

  const ask = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false); // a second request cancels the first
        resolver.current = resolve;
        setTyped("");
        setOpts(o);
      }),
    [],
  );

  const locked = !!opts?.typeToConfirm && typed !== opts.typeToConfirm;
  const dialog = (
    <dialog
      ref={ref}
      className="confirm-dlg"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-b`}
      onCancel={(e) => {
        e.preventDefault();
        finish(false);
      }}
      onClick={(e) => {
        if (e.target === ref.current) finish(false);
      }}
    >
      {opts && (
        <form
          method="dialog"
          className="confirm-box"
          onSubmit={(e) => {
            e.preventDefault();
            if (!locked) finish(true);
          }}
        >
          <h2 id={`${id}-t`}>
            {opts.danger && <AlertTriangle size={20} aria-hidden />}
            {opts.title}
          </h2>
          <div id={`${id}-b`} className="confirm-body">
            {opts.body}
          </div>
          {opts.typeToConfirm && (
            <div className="field">
              <label htmlFor={`${id}-i`}>{t("Type {text} to confirm", { text: opts.typeToConfirm })}</label>
              <input
                id={`${id}-i`}
                className="input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </div>
          )}
          <div className="confirm-actions">
            <button type="button" className="btn ghost" onClick={() => finish(false)} autoFocus={!opts.typeToConfirm}>
              {t("Cancel")}
            </button>
            <button type="submit" className={`btn${opts.danger ? " danger solid" : ""}`} disabled={locked}>
              {opts.confirmLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
  return [dialog, ask];
}
