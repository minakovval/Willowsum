import { useEffect, useState, type ReactNode } from "react";
import { formatNumber, useI18n, type MessageKey } from "@willowsum/i18n";
import { Dialog, type DialogProps } from "@willowsum/ui";
import { GalleryCloseAccount, GalleryGoalForm, GalleryRuleForm } from "./FormDialogDemo.tsx";

/**
 * CMP-21@PoC Dialog (base) in the design-system gallery, on synthetic values: a danger confirmation, «Зберегти
 * зміни?» with three equal buttons, options aligned left, labels that stack, the running action that ends in an
 * error, content taller than the window (only the body scrolls) and the two named wider sizes.
 */
type BaseCase = "delete" | "unsaved" | "options" | "column" | "error" | "long" | "split" | "wide";
/** CMP-21 b): the form with steps, the form without steps and the confirmation that needs a typed word. */
type FormCase = "form" | "short" | "word";
type Case = BaseCase | FormCase;
const CASES: readonly Case[] = [
  "delete",
  "unsaved",
  "options",
  "column",
  "error",
  "long",
  "split",
  "wide",
  "form",
  "short",
  "word",
];
const FORMS: Record<FormCase, (props: { onClose: () => void }) => ReactNode> = {
  form: GalleryGoalForm,
  short: GalleryRuleForm,
  word: GalleryCloseAccount,
};
const isForm = (c: Case): c is FormCase => c in FORMS;
/** How long the gallery's synthetic «delete» runs before it fails. */
const RUN_MS = 1200;

export function DialogDemo() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState<Case | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const close = () => {
    setOpen(null);
    setBusy(false);
    setError(null);
  };

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => {
      setBusy(false);
      setError(
        <>
          <strong>{t("gallery.dialog.error.word")}</strong> {t("gallery.dialog.error.message")}{" "}
          <span className="ws-muted">{t("gallery.dialog.error.code")}</span>
        </>,
      );
    }, RUN_MS);
    return () => window.clearTimeout(timer);
  }, [busy, t]);

  const cancel = { label: t("gallery.dialog.cancel"), onClick: close };
  const done = { label: t("gallery.dialog.done"), variant: "primary" as const, onClick: close };
  const deleting = {
    title: t("gallery.dialog.delete.title"),
    text: t("gallery.dialog.delete.text"),
    icon: "trash" as const,
    tone: "danger" as const,
  };

  const props: Record<BaseCase, Omit<DialogProps, "open" | "onClose" | "closeLabel">> = {
    delete: {
      ...deleting,
      actions: [cancel, { label: t("gallery.dialog.delete.action"), variant: "danger", onClick: close }],
    },
    unsaved: {
      title: t("gallery.dialog.unsaved.title"),
      text: t("gallery.dialog.unsaved.text"),
      icon: "edit",
      alert: true,
      actions: [
        { label: t("gallery.dialog.unsaved.edit"), onClick: close },
        { label: t("gallery.dialog.unsaved.discard"), variant: "danger", onClick: close },
        { label: t("gallery.dialog.unsaved.save"), variant: "primary", onClick: close },
      ],
    },
    options: {
      title: t("gallery.dialog.options.title"),
      text: t("gallery.dialog.options.text"),
      icon: "accounts",
      actions: [cancel, { label: t("gallery.dialog.options.action"), variant: "primary", onClick: close }],
      children: (
        <fieldset className="gallery-dialog__options">
          <legend className="ws-text-label">{t("gallery.dialog.options.legend")}</legend>
          {(["a", "b", "c"] as const).map((id) => (
            <label key={id} className="gallery-dialog__option">
              <input type="radio" name="gallery-dialog-account" defaultChecked={id === "a"} />
              {t(`gallery.dialog.options.${id}`)}
            </label>
          ))}
        </fieldset>
      ),
    },
    column: {
      title: t("gallery.dialog.column.title"),
      text: t("gallery.dialog.column.text"),
      icon: "upload",
      tone: "warning",
      actions: [
        { label: t("gallery.dialog.column.keep"), onClick: close },
        { label: t("gallery.dialog.column.discard"), variant: "danger", onClick: close },
        { label: t("gallery.dialog.column.import"), variant: "primary", onClick: close },
      ],
    },
    error: {
      ...deleting,
      busy,
      error,
      actions: [
        cancel,
        {
          label: t("gallery.dialog.delete.action"),
          variant: "danger",
          busyLabel: t("gallery.dialog.delete.busy"),
          onClick: () => {
            setError(null);
            setBusy(true);
          },
        },
      ],
    },
    long: {
      title: t("gallery.dialog.long.title"),
      text: t("gallery.dialog.long.text"),
      icon: "transactions",
      actions: [cancel, done],
      children: (
        <ul className="gallery-dialog__rows">
          {Array.from({ length: 30 }, (_, i) => (
            <li key={i}>{t("gallery.dialog.long.row", { n: formatNumber(locale, String(i + 1)) })}</li>
          ))}
        </ul>
      ),
    },
    split: {
      title: t("gallery.dialog.split.title"),
      text: t("gallery.dialog.split.text"),
      size: "split",
      align: "start",
      actions: [cancel, done],
    },
    wide: {
      title: t("gallery.dialog.wide.title"),
      text: t("gallery.dialog.wide.text"),
      size: "wide",
      align: "start",
      actions: [cancel, done],
    },
  };

  const opener: Record<Case, MessageKey> = {
    delete: "gallery.dialog.open.delete",
    unsaved: "gallery.dialog.open.unsaved",
    options: "gallery.dialog.open.options",
    column: "gallery.dialog.open.column",
    error: "gallery.dialog.open.error",
    long: "gallery.dialog.open.long",
    split: "gallery.dialog.open.split",
    wide: "gallery.dialog.open.wide",
    form: "gallery.dialog.open.form",
    short: "gallery.dialog.open.short",
    word: "gallery.dialog.open.word",
  };
  const Form = open && isForm(open) ? FORMS[open] : null;

  return (
    <div className="gallery-dialog">
      <p className="ws-muted">{t("gallery.dialog.intro")}</p>
      <div className="gallery-dialog__openers">
        {CASES.map((c) => (
          <button key={c} type="button" className="ws-button" data-case={c} onClick={() => setOpen(c)}>
            {t(opener[c])}
          </button>
        ))}
      </div>
      {Form ? (
        <Form key={open} onClose={close} />
      ) : open && !isForm(open) ? (
        <Dialog key={open} open onClose={close} closeLabel={t("gallery.dialog.close")} {...props[open]} />
      ) : null}
    </div>
  );
}
