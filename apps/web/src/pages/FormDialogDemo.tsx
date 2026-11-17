import { useState } from "react";
import { useI18n } from "@willowsum/i18n";
import { AmountField, ConfirmDialog, Field, FormDialog, FormMore, type FormDialogField } from "@willowsum/ui";

/**
 * CMP-21@PoC b) in the design-system gallery, on synthetic values: «Нова ціль» split into three steps (the indicator,
 * the reason line, a taken number on step 3), «Правило категорії» without steps with «Додатково», and the
 * confirmation that needs a typed word. Nothing is saved: the main action only closes the dialog.
 */
export function GalleryGoalForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [targetProblem, setTargetProblem] = useState(false);
  const [date, setDate] = useState("");
  const [monthly, setMonthly] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [account, setAccount] = useState("");
  const [number, setNumber] = useState("");
  const [note, setNote] = useState("");
  const fields: FormDialogField[] = [
    { id: "name", label: t("gallery.dialog.form.name"), required: true, empty: name.trim() === "" },
    {
      id: "target",
      label: t("gallery.dialog.form.target"),
      required: true,
      empty: target === null && !targetProblem,
      error: targetProblem ? t("gallery.dialog.form.target") : null,
    },
    { id: "date", label: t("gallery.dialog.form.date"), empty: date === "" },
    { id: "monthly", label: t("gallery.dialog.form.monthly"), step: 1, empty: monthly === null },
    { id: "start", label: t("gallery.dialog.form.start"), step: 1, empty: start === "" },
    { id: "account", label: t("gallery.dialog.form.account"), step: 1, empty: account === "" },
    {
      id: "number",
      label: t("gallery.dialog.form.number"),
      step: 2,
      empty: number === "",
      error: number.trim() === "4417" ? t("gallery.dialog.form.numberTaken") : null,
    },
    { id: "note", label: t("gallery.dialog.form.note"), step: 2, empty: note === "" },
  ];
  return (
    <FormDialog
      open
      onClose={onClose}
      closeLabel={t("gallery.dialog.close")}
      title={t("gallery.dialog.form.title")}
      steps={[
        { label: t("gallery.dialog.form.step.main") },
        { label: t("gallery.dialog.form.step.contributions") },
        { label: t("gallery.dialog.form.step.extra") },
      ]}
      fields={fields}
      submitLabel={t("gallery.dialog.form.submit")}
      busyLabel={t("gallery.dialog.form.busy")}
      onSubmit={onClose}
    >
      {(form) =>
        form.step === 0 ? (
          <>
            <Field
              label={t("gallery.dialog.form.name")}
              required
              value={name}
              placeholder={t("gallery.dialog.form.namePlaceholder")}
              onChange={setName}
              onBlur={form.leave("name")}
              error={form.errorOf("name")}
            />
            <AmountField
              label={t("gallery.dialog.form.target")}
              required
              currency="EUR"
              value={target}
              onChange={(value, problem) => {
                setTarget(value);
                setTargetProblem(problem !== null);
              }}
              onBlur={form.leave("target")}
              error={targetProblem ? undefined : form.errorOf("target")}
            />
            <Field
              label={t("gallery.dialog.form.date")}
              value={date}
              placeholder={t("gallery.dialog.form.datePlaceholder")}
              onChange={setDate}
              onBlur={form.leave("date")}
            />
          </>
        ) : form.step === 1 ? (
          <>
            <AmountField
              label={t("gallery.dialog.form.monthly")}
              currency="EUR"
              value={monthly}
              hint={t("gallery.dialog.form.monthlyHint")}
              onChange={(value) => setMonthly(value)}
              onBlur={form.leave("monthly")}
            />
            <Field
              label={t("gallery.dialog.form.start")}
              value={start}
              placeholder={t("gallery.dialog.form.datePlaceholder")}
              onChange={setStart}
              onBlur={form.leave("start")}
            />
            <Field
              label={t("gallery.dialog.form.account")}
              value={account}
              placeholder={t("gallery.dialog.form.accountPlaceholder")}
              onChange={setAccount}
              onBlur={form.leave("account")}
            />
          </>
        ) : (
          <>
            <p className="ws-muted gallery-dialog__step-hint">{t("gallery.dialog.form.extraHint")}</p>
            <Field
              label={t("gallery.dialog.form.number")}
              value={number}
              inputMode="numeric"
              maxLength={4}
              onChange={setNumber}
              onBlur={form.leave("number")}
              error={form.errorOf("number")}
            />
            <Field
              label={t("gallery.dialog.form.note")}
              value={note}
              placeholder={t("gallery.dialog.form.notePlaceholder")}
              onChange={setNote}
              onBlur={form.leave("note")}
            />
          </>
        )
      }
    </FormDialog>
  );
}

export function GalleryRuleForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  return (
    <FormDialog
      open
      onClose={onClose}
      closeLabel={t("gallery.dialog.close")}
      title={t("gallery.dialog.short.title")}
      fields={[
        {
          id: "pattern",
          label: t("gallery.dialog.short.pattern"),
          required: true,
          empty: pattern.trim() === "",
        },
        {
          id: "category",
          label: t("gallery.dialog.short.category"),
          required: true,
          empty: category.trim() === "",
        },
        { id: "note", label: t("gallery.dialog.form.note"), empty: note === "" },
      ]}
      submitLabel={t("gallery.dialog.short.submit")}
      onSubmit={onClose}
    >
      {(form) => (
        <>
          <Field
            label={t("gallery.dialog.short.pattern")}
            required
            value={pattern}
            onChange={setPattern}
            onBlur={form.leave("pattern")}
            error={form.errorOf("pattern")}
          />
          <Field
            label={t("gallery.dialog.short.category")}
            required
            value={category}
            onChange={setCategory}
            onBlur={form.leave("category")}
            error={form.errorOf("category")}
          />
          <FormMore label={t("gallery.dialog.short.more")} fields={["note"]}>
            <Field
              label={t("gallery.dialog.form.note")}
              value={note}
              placeholder={t("gallery.dialog.form.notePlaceholder")}
              onChange={setNote}
              onBlur={form.leave("note")}
            />
          </FormMore>
        </>
      )}
    </FormDialog>
  );
}

export function GalleryCloseAccount({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      closeLabel={t("gallery.dialog.close")}
      title={t("gallery.dialog.word.title")}
      text={t("gallery.dialog.word.text")}
      cancelLabel={t("gallery.dialog.cancel")}
      confirmLabel={t("gallery.dialog.word.action")}
      busyLabel={t("gallery.dialog.word.busy")}
      onConfirm={onClose}
      confirmWord={{
        word: t("gallery.dialog.word.word"),
        label: t("gallery.dialog.word.label"),
        reason: t("gallery.dialog.word.reason"),
      }}
    />
  );
}
