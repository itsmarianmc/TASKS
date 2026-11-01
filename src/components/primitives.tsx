"use client";
import { useTranslation } from "./localization";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState, type ReactNode, type KeyboardEvent, type CSSProperties } from "react";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
  modal = true,
  style,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  modal?: boolean;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={`dialog ${className}`} style={style} onInteractOutside={event => {
          if (className.includes("task-drawer") && (event.target as HTMLElement)?.closest("[data-task-id],.mutation-toasts,.completion-toasts,.mutation-sync")) event.preventDefault();
        }} {...(!description ? { "aria-describedby": undefined } : {})}>
          <div className="dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label={t("ui.close")}>
              <X size={16} />
            </Dialog.Close>
          </div>
          {description && <Dialog.Description className="dialog-description">
            {description}
          </Dialog.Description>}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  optimistic = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => Promise<unknown>;
  optimistic?: boolean;
}) {
  const { t, text: tx } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setError("");
          onOpenChange(value);
        }
      }}
      title={title}
      description={description}
    >
      {error && (
        <p className="error-text" role="alert">
          {tx(error)}
        </p>
      )}
      <div className="dialog-actions">
        <button
          autoFocus
          className="button"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          {t("ui.cancel")}</button>
        <button
          className="button danger"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              const result = onConfirm();
              if (optimistic) onOpenChange(false);
              await result;
              onOpenChange(false);
            } catch (error) {
              if (optimistic) return; // The central mutation layer restores the item and reports failure globally.
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not delete. Try again.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? t("ui.deleting") : t("ui.delete_f6fdbe4")}
        </button>
      </div>
    </Modal>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">
        Æ
      </span>
      <h2>{title}</h2>
      {children && <div className="empty-description">{children}</div>}
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}
export function InlineError({ error }: { error: unknown }) {
  const { t, text: tx } = useTranslation();
  return error ? (
    <p className="error-text" role="alert">
      {error instanceof Error ? tx(error.message) : t("ui.something_went_wrong_try_again")}
    </p>
  ) : null;
}

/** Use on a container whose rows contain data-list-row buttons. Tab remains native. */
export function moveListFocus(event: KeyboardEvent<HTMLElement>) {
  if (
    !["ArrowDown", "ArrowUp", "Home", "End", "j", "k"].includes(event.key) ||
    event.ctrlKey || event.metaKey || event.altKey ||
    (event.target as HTMLElement).matches(
      "input,textarea,select,[contenteditable=true]",
    )
  )
    return;
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "[data-list-row]:not(:disabled)",
    ),
  ).filter(row => row.getClientRects().length > 0);
  if (!rows.length) return;
  const index = rows.findIndex((row) => row === document.activeElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : event.key === "ArrowDown" || event.key === "j"
          ? Math.min(rows.length - 1, index + 1)
          : Math.max(0, index - 1);
  event.preventDefault();
  rows[next]?.focus();
}
