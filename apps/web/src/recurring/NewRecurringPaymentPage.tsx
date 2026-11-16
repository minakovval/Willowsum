import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { newIdempotencyKey, type operations } from "@willowsum/api-contract";
import { useI18n, type MessageKey } from "@willowsum/i18n";
import { Icon, Skeleton } from "@willowsum/ui";
import { outcome, useAuthApi } from "../auth/api.ts";
import { failureOf } from "../auth/failure.ts";
import { AppLayout } from "../pages/AppLayout.tsx";
import { ChildHeader } from "../pages/SectionPage.tsx";
import { RECURRING, type ChildDef } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import {
  FREQUENCIES,
  kyivToday,
  loadFormChoices,
  useLoad,
  type FormChoices,
  type Frequency,
} from "./data.ts";
import { FREQUENCY_KEYS } from "./format.ts";

/**
 * BUD-07@PoC FR 6, S-141 «Додати вручну»: name, amount, frequency, anchor date, category, account, end date, type,
 * «Підписка» and «Змінна сума». The canvas has no board for this form (PR body, owner question): it follows the
 * fields of the payment details (PocPlanRecurringPayment) and the minimal fields of the sign-in cards (CMP-02).
 */
type Body = operations["createRecurringPayment"]["requestBody"]["content"]["application/json"];
type Field = "name" | "amount" | "currency" | "anchorDate" | "endDate" | "categoryId" | "accountId";
type Errors = Partial<Record<Field, MessageKey>>;

const NAME_MAX = 60;
const AMOUNT = /^\d{1,13}([.,]\d{1,2})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const ISSUE_KEYS: Readonly<Record<string, MessageKey>> = {
  name: "recurring.form.error.name",
  amount: "recurring.form.error.amount",
  frequency: "recurring.form.error.date",
  anchorDate: "recurring.form.error.date",
  endDate: "recurring.form.error.endDate",
  categoryId: "recurring.form.error.category",
  accountId: "recurring.form.error.account",
};

interface Values {
  name: string;
  amount: string;
  currency: string;
  frequency: Frequency;
  anchorDate: string;
  type: "expense" | "income";
  categoryId: string;
  accountId: string;
  endDate: string;
  subscription: boolean;
  variable: boolean;
}

function check(v: Values): Errors {
  const e: Errors = {};
  const name = v.name.trim();
  if (name.length === 0 || [...name].length > NAME_MAX) e.name = "recurring.form.error.name";
  const amount = v.amount.replace(/\s/g, "");
  if (!AMOUNT.test(amount) || /^[0.,]+$/.test(amount)) e.amount = "recurring.form.error.amount";
  if (!CURRENCY.test(v.currency)) e.currency = "recurring.form.error.currency";
  if (!DATE.test(v.anchorDate)) e.anchorDate = "recurring.form.error.date";
  if (v.endDate !== "" && (!DATE.test(v.endDate) || v.endDate < v.anchorDate))
    e.endDate = "recurring.form.error.endDate";
  return e;
}

function bodyOf(v: Values): Body {
  return {
    name: v.name.trim(),
    amount: { amount: v.amount.replace(/\s/g, "").replace(",", "."), currency: v.currency },
    frequency: v.frequency,
    anchorDate: v.anchorDate,
    type: v.type,
    categoryId: v.categoryId || null,
    accountId: v.accountId || null,
    endDate: v.endDate || null,
    subscription: v.subscription,
    variable: v.variable,
  };
}

export function NewRecurringPaymentPage({ child, today = kyivToday() }: { child: ChildDef; today?: string }) {
  const { t } = useI18n();
  const title = t(child.title);
  useDocumentTitle(title);
  const { result } = useLoad(loadFormChoices);
  return (
    <AppLayout sectionId={RECURRING.sectionId} pageId={RECURRING.id}>
      <ChildHeader child={child} title={title} />
      <section className="ws-card rec-card rec-form-card">
        {result.state === "ready" ? (
          <PaymentForm today={today} choices={result.data} />
        ) : (
          <Skeleton variant="text" lines={6} />
        )}
      </section>
    </AppLayout>
  );
}

function PaymentForm({ today, choices }: { today: string; choices: FormChoices }) {
  const { t } = useI18n();
  const api = useAuthApi();
  const [v, setV] = useState<Values>({
    name: "",
    amount: "",
    currency: "EUR",
    frequency: "month",
    anchorDate: today,
    type: "expense",
    categoryId: "",
    accountId: "",
    endDate: "",
    subscription: false,
    variable: false,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<{ key: MessageKey; code?: string | undefined } | null>(null);
  const [saving, setSaving] = useState(false);
  // The same request keeps its key on a retry (ARC-07 FR 4); a changed request takes a new one.
  const sent = useRef<{ body: string; key: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((old) => ({ ...old, [k]: value }));
  const accounts = [...choices.accounts.values()].filter((a) => a.selectable);
  const categories = [...choices.categories.values()].filter((c) => c.kind === v.type && !c.hidden);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const found = check(v);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) {
      focusFirstInvalid(formRef.current);
      return;
    }
    const body = bodyOf(v);
    const text = JSON.stringify(body);
    if (sent.current?.body !== text) sent.current = { body: text, key: newIdempotencyKey() };
    setSaving(true);
    const o = await outcome(
      api.POST("/v1/recurring/payments", {
        params: { header: { "Idempotency-Key": sent.current.key } },
        body,
      }),
    );
    setSaving(false);
    if (o.ok) {
      window.location.hash = hrefFor(RECURRING.path);
      return;
    }
    if (o.kind === "problem" && o.problem.code === "VALIDATION_FAILED" && o.problem.errors?.length) {
      const fromServer: Errors = {};
      for (const issue of o.problem.errors) {
        const key = ISSUE_KEYS[issue.path];
        if (key && issue.path !== "frequency") fromServer[issue.path as Field] = key;
      }
      if (Object.keys(fromServer).length > 0) {
        setErrors(fromServer);
        focusFirstInvalid(formRef.current);
        return;
      }
    }
    const f = failureOf(o);
    setFailure({ key: f.key, code: f.code });
  };

  return (
    <form ref={formRef} className="auth-form rec-form" noValidate onSubmit={(e) => void submit(e)}>
      <Text
        label={t("recurring.form.name")}
        required
        value={v.name}
        onChange={(x) => set("name", x)}
        error={errors.name}
        maxLength={NAME_MAX}
      />
      <div className="rec-form-row">
        <Text
          label={t("recurring.form.amount")}
          required
          inputMode="decimal"
          value={v.amount}
          onChange={(x) => set("amount", x)}
          error={errors.amount}
        />
        <Text
          label={t("recurring.form.currency")}
          required
          value={v.currency}
          onChange={(x) => set("currency", x.toUpperCase())}
          error={errors.currency}
          maxLength={3}
        />
      </div>
      <fieldset className="rec-fieldset">
        <legend className="auth-label">{t("recurring.form.type")}</legend>
        <div className="rec-choice-row">
          {(["expense", "income"] as const).map((type) => (
            <label key={type} className="rec-choice">
              <input
                type="radio"
                name="rec-type"
                checked={v.type === type}
                onChange={() => setV((old) => ({ ...old, type, categoryId: "" }))}
              />
              <span>
                {t(type === "expense" ? "recurring.form.type.expense" : "recurring.form.type.income")}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="rec-form-row">
        <Choice
          label={t("recurring.form.frequency")}
          required
          value={v.frequency}
          onChange={(x) => set("frequency", x as Frequency)}
        >
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {t(FREQUENCY_KEYS[f])}
            </option>
          ))}
        </Choice>
        <Text
          label={t("recurring.form.anchorDate")}
          required
          type="date"
          value={v.anchorDate}
          onChange={(x) => set("anchorDate", x)}
          error={errors.anchorDate}
          hint={t("recurring.form.anchorHint")}
        />
      </div>
      <Choice
        label={t("recurring.form.category")}
        value={v.categoryId}
        onChange={(x) => set("categoryId", x)}
        error={errors.categoryId}
      >
        <option value="">{t("recurring.noCategory")}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Choice>
      <Choice
        label={t("recurring.form.account")}
        value={v.accountId}
        onChange={(x) => {
          const currency = choices.accounts.get(x)?.currency;
          setV((old) => ({ ...old, accountId: x, ...(currency ? { currency } : {}) }));
        }}
        error={errors.accountId}
      >
        <option value="">{t("recurring.noAccount")}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </Choice>
      <Text
        label={t("recurring.form.endDate")}
        type="date"
        value={v.endDate}
        onChange={(x) => set("endDate", x)}
        error={errors.endDate}
        hint={t("recurring.form.endHint")}
      />
      <div className="rec-choice-row">
        <label className="rec-choice">
          <input
            type="checkbox"
            checked={v.subscription}
            onChange={(e) => set("subscription", e.target.checked)}
          />
          <span>{t("recurring.form.subscription")}</span>
        </label>
        <label className="rec-choice">
          <input type="checkbox" checked={v.variable} onChange={(e) => set("variable", e.target.checked)} />
          <span>{t("recurring.form.variable")}</span>
        </label>
      </div>
      {failure ? (
        <p className="auth-field-error" role="alert">
          <Icon name="warning" size={16} />
          <span>
            <b>{t("recurring.form.error.word")}</b> {t("recurring.form.error.save")} {t(failure.key)}
            {failure.code ? ` ${t("recurring.error.code", { code: failure.code })}` : ""}
          </span>
        </p>
      ) : null}
      <div className="app-page-actions">
        <button type="submit" className="ws-button ws-button-primary" aria-disabled={saving || undefined}>
          {t("recurring.form.save")}
        </button>
        <a className="ws-button" href={hrefFor(RECURRING.path)}>
          {t("recurring.form.cancel")}
        </a>
      </div>
    </form>
  );
}

function focusFirstInvalid(form: HTMLFormElement | null): void {
  // After the render that marks the fields.
  queueMicrotask(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

interface FrameProps {
  readonly label: string;
  readonly required?: boolean | undefined;
  readonly error?: MessageKey | undefined;
  readonly hint?: string | undefined;
  readonly children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Label above, the error with «Помилка» in place of the hint, the required mark in words too (CMP-02, as auth). */
function Frame({ label, required, error, hint, children }: FrameProps) {
  const { t } = useI18n();
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ? (
    <span className="auth-field-error" id={noteId}>
      <Icon name="warning" size={16} />
      <span>
        <b>{t("recurring.form.error.word")}</b> {t(error)}
      </span>
    </span>
  ) : hint ? (
    <span className="auth-hint" id={noteId}>
      {hint}
    </span>
  ) : null;
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={id}>
        {label}
        {required ? (
          <>
            <span className="auth-required" aria-hidden="true">
              {" *"}
            </span>
            <span className="ws-visually-hidden">{`, ${t("recurring.form.required")}`}</span>
          </>
        ) : null}
      </label>
      {children({ id, describedBy: note ? noteId : undefined, invalid: Boolean(error) })}
      {note}
    </div>
  );
}

function Text({
  label,
  required,
  value,
  onChange,
  error,
  hint,
  type = "text",
  inputMode,
  maxLength,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: MessageKey | undefined;
  hint?: string;
  type?: "text" | "date";
  inputMode?: "decimal";
  maxLength?: number;
}) {
  return (
    <Frame label={label} required={required} error={error} hint={hint}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className="auth-input"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          {...(inputMode ? { inputMode } : {})}
          {...(maxLength ? { maxLength } : {})}
          autoComplete="off"
        />
      )}
    </Frame>
  );
}

function Choice({
  label,
  required,
  value,
  onChange,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: MessageKey | undefined;
  children: ReactNode;
}) {
  return (
    <Frame label={label} required={required} error={error}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          className="auth-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        >
          {children}
        </select>
      )}
    </Frame>
  );
}
