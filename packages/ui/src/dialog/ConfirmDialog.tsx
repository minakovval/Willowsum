import { useState, type ReactNode } from "react";
import { Field } from "../field/Field.tsx";
import type { IconName } from "../icons/Icon.tsx";
import { Dialog, type DialogProps } from "./Dialog.tsx";

export interface ConfirmWord {
  /** The word to type exactly, e.g. «ВИДАЛИТИ» for closing the account. */
  word: string;
  /** The field's visible label («Введіть ВИДАЛИТИ, щоб підтвердити»). */
  label: string;
  /** The line above the buttons while the word is not typed yet: why the main action is inactive. */
  reason: string;
}

export interface ConfirmDialogProps extends Pick<
  DialogProps,
  "open" | "onClose" | "title" | "closeLabel" | "busy" | "error" | "alert"
> {
  /** One or two sentences: what will happen. */
  text: ReactNode;
  icon?: IconName | undefined;
  /** `danger` (the default) for a destructive action: `alertdialog`, `tint-negative` tile, the `danger` button. */
  tone?: "danger" | "warning" | "info" | undefined;
  /** The safe way out, first in the row and focused on opening («Скасувати»). */
  cancelLabel: string;
  /** Repeats the verb of the title («Видалити рахунок», not «ОК»). */
  confirmLabel: string;
  /** The confirm label while `busy` («Видаляємо…»). */
  busyLabel?: string | undefined;
  onConfirm: () => void;
  /** The dangerous action needs a typed word: until it is typed exactly, the main action is inactive (AC4). */
  confirmWord?: ConfirmWord | undefined;
}

/**
 * CMP-21@PoC the confirmation of a dangerous action, built on `Dialog`: «Скасувати» and the action that repeats the
 * title's verb, in one row of equal width; the danger action never gets focus by default (AC1). With `confirmWord`
 * the dialog has one field, focused on opening, and the action stays inactive (`aria-disabled`, described by the
 * reason line) until the word is typed exactly — surrounding spaces aside, letter case counts (AC4).
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  text,
  icon = "trash",
  tone = "danger",
  alert,
  closeLabel,
  busy,
  error,
  cancelLabel,
  confirmLabel,
  busyLabel,
  onConfirm,
  confirmWord,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  // Opening again starts with the field empty (state adjusted during render).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setTyped("");
  }
  const confirmed = !confirmWord || typed.trim() === confirmWord.word;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      text={text}
      icon={icon}
      tone={tone}
      alert={alert}
      closeLabel={closeLabel}
      busy={busy}
      error={error}
      align={confirmWord ? "start" : "center"}
      note={confirmed ? undefined : confirmWord?.reason}
      actions={[
        { label: cancelLabel, onClick: onClose },
        {
          label: confirmLabel,
          variant: tone === "danger" ? "danger" : "primary",
          busyLabel,
          disabled: !confirmed,
          onClick: onConfirm,
        },
      ]}
    >
      {confirmWord ? (
        <Field label={confirmWord.label} value={typed} onChange={setTyped} autoComplete="off" />
      ) : null}
    </Dialog>
  );
}
