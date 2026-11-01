"use client";

import { useEffect, useId, useRef, type ButtonHTMLAttributes } from "react";
import { buttonClass, type ButtonVariant } from "@/components/Form";

/**
 * A submit button that requires an in-page confirmation before the form
 * submission is allowed to proceed. Used for actions that should not fire
 * from a stale tab or accidental double-click (e.g. withdrawing consent).
 *
 * Deliberately NOT window.confirm: consent withdrawal is legally relevant, so
 * the prompt has to be on-brand, reachable by assistive tech, and reliable on
 * iOS Safari and installed-PWA contexts, where native confirm can be
 * suppressed or rendered awkwardly.
 *
 * Uses a native <dialog> opened with showModal(), which gives us the focus
 * trap, focus restore, inertness of the page behind, and Escape-to-dismiss
 * for free. The trigger stays type="submit" so the button keeps working as
 * the form's submitter (any name/value it carries is still sent): the click
 * is cancelled, and confirming calls form.requestSubmit(trigger).
 */
export default function ConfirmSubmitButton({
  confirmMessage,
  confirmLabel,
  children,
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  confirmMessage: string;
  confirmLabel?: string;
  variant?: ButtonVariant;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Safety net: if the dialog is somehow still open when this unmounts (a
  // navigation mid-confirm), close it so the top layer is not left occupied.
  useEffect(() => {
    const dialog = dialogRef.current;
    return () => dialog?.close();
  }, []);

  function confirm() {
    dialogRef.current?.close();
    const button = buttonRef.current;
    // requestSubmit(submitter) does not re-fire our onClick, so this cannot
    // loop back into the dialog.
    button?.form?.requestSubmit(button);
  }

  return (
    <>
      <button
        {...props}
        ref={buttonRef}
        type="submit"
        className={buttonClass(variant, className)}
        onClick={(e) => {
          e.preventDefault();
          dialogRef.current?.showModal();
        }}
      >
        {children}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded border border-line bg-white p-6 text-ink shadow-xl backdrop:bg-navy/45"
      >
        <h2 id={titleId} className="font-heading text-base text-ink">
          Please confirm
        </h2>
        <p className="mt-3 text-sm text-ink">{confirmMessage}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={confirm} className={buttonClass(variant)}>
            {confirmLabel ?? children}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => dialogRef.current?.close()}
            className={buttonClass("ghost")}
          >
            Cancel
          </button>
        </div>
      </dialog>
    </>
  );
}
