import { useMemo, useRef, useState } from "react";
import { currencyInfo, knownCurrencies } from "@willowsum/domain-kernel";
import { newIdempotencyKey } from "@willowsum/api-contract";
import { formatLocaleOf, formatMoney, useI18n, type MessageKey } from "@willowsum/i18n";
import {
  AmountField,
  amountInPlaces,
  Button,
  DateField,
  Field,
  FormDialog,
  IconButton,
  SearchSelect,
  Select,
  type FormDialogField,
  type FormDialogState,
} from "@willowsum/ui";
import { outcome, useAuthApi } from "../auth/api.ts";
import { accountPath } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { countryOptions } from "./countries.ts";
import {
  bodyOf,
  EARLIEST_DATE,
  hasCardNumber,
  hasCardTerms,
  hasDepositDates,
  hasExtraCurrencies,
  hasMonthly,
  hasRate,
  initialValues,
  institutionNameProblem,
  institutionOf,
  isDebt,
  isNegative,
  isPositive,
  KIND_DESCRIPTION,
  KIND_LABEL,
  KINDS,
  nameProblem,
  NOTE_MAX,
  normalNumber,
  numberProblem,
  OTHER_INSTITUTION,
  parseGrace,
  parseRate,
  useBanks,
  useDuplicate,
  type AccountKind,
  type ExtraCurrency,
  type NewAccountValues,
} from "./newAccount.ts";

/**
 * «+ додати ще валюту» in the form adds one more currency: a second row would make step 3 taller than the dialog may
 * be at 1280 × 720 (CMP-21 п. 7, FIN-01 FR 3 — three steps, owner 2026-11-13). Further currencies are added on the
 * account (FR 12, «+ додати ще валюту» of its settings, up to 10). Lead decision 2026-11-17
 * (decision log, 2026-11-17, «S-052 «Новий рахунок» — рішення ведучого»).
 */
const EXTRAS_IN_FORM = 1;

/** The steps of FIN-01@PoC FR 3 (owner, 2026-11-13): «1 Основне · 2 Залишок · 3 Додатково». */
const MAIN = 0;
const BALANCE = 1;
const EXTRA = 2;

/**
 * «Валюта*» (код ISO 4217, FR 3): the ISO 4217 currencies of the registry only — no metals and no crypto-assets,
 * which are not ISO 4217 codes (`Intl` cannot format USDT) and have other digits (BTC 8).
 */
const CURRENCY_OPTIONS = knownCurrencies()
  .filter((c) => c.kind === "fiat")
  .map((c) => ({ value: c.code, label: c.code }));

/** The digits after the point of a currency, as the server checks them (`domain-kernel`); EUR's 2 before one is chosen. */
const placesOf = (currency: string): number => (currency ? currencyInfo(currency).minorUnits : 2);

/** An amount with more significant digits than its chosen currency has: never sent (FR 3, `balance.amount`). */
const unfit = (amount: string | null, currency: string): boolean =>
  amount !== null && currency !== "" && amountInPlaces(amount, placesOf(currency)) === null;

/**
 * S-052 «Новий рахунок» (FIN-01@PoC FR 1, FR 3–6, FR 8, FR 12, FR 25; canvas PocMoneyNewAcc, PocMoneyNewAccStep3,
 * PocMoneyNewAccLoan and PocMoneyNewAccTexts) on the CMP-21 b) form dialog: three steps, «Додати рахунок» inactive
 * until the required fields of the kind are valid, no «Власники» (the server records the Owner with 100 %). The bank
 * comes from the NBU directory or «Інша установа» with a name and a country. One request per press: the same request
 * keeps its `Idempotency-Key` on a retry, a changed one takes a new key (ARC-07 FR 4).
 */
export function NewAccountDialog({
  open,
  today,
  initialKind,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** «Сьогодні» of the space (П-27), YYYY-MM-DD: the default «На дату». */
  today: string;
  initialKind?: AccountKind | undefined;
  onClose: () => void;
  onCreated: (accountId: string) => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const format = formatLocaleOf(locale);
  const [v, setV] = useState<NewAccountValues>(() => initialValues(today, initialKind));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ key: MessageKey; code?: string | undefined } | null>(null);
  /** The duplicate check that `POST /v1/accounts` refused with 409 `ACCOUNT_DUPLICATE` (FR 25), and its text. */
  const [refused, setRefused] = useState<{ key: string; text: string } | null>(null);
  const sent = useRef<{ body: string; key: string } | null>(null);
  const nextKey = useRef(0);
  const { banks, loading: banksLoading } = useBanks(api, open);
  const countries = useMemo(() => countryOptions(format), [format]);

  const set = <K extends keyof NewAccountValues>(k: K, value: NewAccountValues[K]) => {
    setFailure(null);
    setV((old) => ({ ...old, [k]: value }));
  };
  const setExtra = (key: number, change: Partial<ExtraCurrency>) => {
    setFailure(null);
    setV((old) => ({ ...old, extras: old.extras.map((e) => (e.key === key ? { ...e, ...change } : e)) }));
  };

  const kind = v.kind;
  const debt = isDebt(kind);
  const institution = institutionOf(v, banks);
  const numberError = numberProblem(v.number);
  const extras = hasExtraCurrencies(kind) ? v.extras : [];
  const currencies = [v.currency, ...extras.map((e) => e.currency)].filter(Boolean);
  const duplicateQuery =
    open && v.number.trim() !== "" && !numberError && currencies.length > 0
      ? { institution, number: normalNumber(v.number), currencies }
      : null;
  const duplicateKey = duplicateQuery ? JSON.stringify(duplicateQuery) : "";
  const { duplicate, recheck } = useDuplicate(api, duplicateQuery);
  const duplicateText = duplicate
    ? t("newAccount.duplicate", { institution: duplicate.institution, last4: duplicate.last4 })
    : refused && refused.key === duplicateKey
      ? refused.text
      : null;

  const nameError = nameProblem(v.name);
  const balanceNegative = !debt && kind !== "current" && isNegative(v.balance);
  const debtNegative = debt && isNegative(v.balance);
  const rate = v.rate.trim() === "" ? null : parseRate(v.rate);
  const datesWrong = Boolean(v.openedOn && v.maturesOn && v.maturesOn <= v.openedOn);
  const other = v.bank === OTHER_INSTITUTION;
  const taken = (e: ExtraCurrency) =>
    e.currency !== "" &&
    (e.currency === v.currency || extras.some((x) => x !== e && x.currency === e.currency && x.key < e.key));

  const fields: FormDialogField[] = [
    { id: "kind", label: t("newAccount.type"), step: MAIN, required: true, empty: false },
    {
      id: "name",
      label: t("newAccount.name"),
      step: MAIN,
      required: true,
      empty: v.name.trim() === "",
      emptyError: t("newAccount.error.name.empty"),
      error: nameError ? t(nameError) : null,
    },
    { id: "institution", label: t("newAccount.institution"), step: MAIN, empty: v.bank === "" },
    ...(other
      ? [
          {
            id: "otherName",
            label: t("newAccount.institution.otherName"),
            step: MAIN,
            required: true,
            empty: v.otherName.trim() === "",
            error: institutionNameProblem(v.otherName) ? t("newAccount.error.institution.long") : null,
          },
          {
            id: "country",
            label: t("newAccount.institution.country"),
            step: MAIN,
            required: true,
            empty: v.country === "",
            emptyError: t("newAccount.error.country"),
          },
        ]
      : []),
    {
      id: "balance",
      label: t(debt ? "newAccount.balance.debt" : "newAccount.balance"),
      step: BALANCE,
      required: true,
      empty: v.balance === null && !v.balanceProblem,
      emptyError: t("newAccount.error.balance.empty"),
      error:
        v.balanceProblem || unfit(v.balance, v.currency)
          ? t(debt ? "newAccount.balance.debt" : "newAccount.balance")
          : balanceNegative || debtNegative
            ? t("newAccount.error.balance.negative")
            : null,
    },
    {
      id: "currency",
      label: t("newAccount.currency"),
      step: BALANCE,
      required: true,
      empty: v.currency === "",
      emptyError: t("newAccount.error.currency"),
    },
    {
      id: "date",
      label: t("newAccount.date"),
      step: BALANCE,
      required: true,
      empty: v.date === "",
      emptyError: t("newAccount.error.date"),
      error: v.date !== "" && v.date < EARLIEST_DATE ? t("newAccount.error.date.early") : null,
    },
    {
      id: "number",
      label: t("newAccount.number"),
      step: EXTRA,
      empty: v.number.trim() === "",
      error: numberError ? t(numberError) : duplicateText,
    },
    ...(hasRate(kind)
      ? [
          {
            id: "rate",
            label: t("newAccount.rate"),
            step: EXTRA,
            required: kind === "loan",
            empty: v.rate.trim() === "",
            error: v.rate.trim() !== "" && rate === null ? t("newAccount.error.rate") : null,
          },
        ]
      : []),
    ...(hasMonthly(kind)
      ? [
          {
            id: "monthly",
            label: t("newAccount.monthly"),
            step: EXTRA,
            required: true,
            empty: v.monthly === null && !v.monthlyProblem,
            emptyError: t("newAccount.error.monthly"),
            error:
              v.monthlyProblem || unfit(v.monthly, v.currency)
                ? t("newAccount.monthly")
                : v.monthly !== null && !isPositive(v.monthly)
                  ? t("newAccount.error.monthly")
                  : null,
          },
        ]
      : []),
    ...(hasDepositDates(kind)
      ? [
          { id: "openedOn", label: t("newAccount.openedOn"), step: EXTRA, empty: v.openedOn === "" },
          {
            id: "maturesOn",
            label: t("newAccount.maturesOn"),
            step: EXTRA,
            empty: v.maturesOn === "",
            error: datesWrong ? t("newAccount.error.maturesOn") : null,
          },
        ]
      : []),
    ...(hasCardTerms(kind)
      ? [
          {
            id: "creditLimit",
            label: t("newAccount.creditLimit"),
            step: EXTRA,
            empty: v.creditLimit === null && !v.creditLimitProblem,
            error:
              v.creditLimitProblem || isNegative(v.creditLimit) || unfit(v.creditLimit, v.currency)
                ? t("newAccount.creditLimit")
                : null,
          },
          {
            id: "grace",
            label: t("newAccount.grace"),
            step: EXTRA,
            empty: v.grace.trim() === "",
            error: v.grace.trim() !== "" && parseGrace(v.grace) === null ? t("newAccount.error.grace") : null,
          },
        ]
      : []),
    ...extras.flatMap((e): FormDialogField[] => [
      {
        id: `extra-${e.key}-currency`,
        label: t("newAccount.currency"),
        step: EXTRA,
        required: true,
        empty: e.currency === "",
        emptyError: t("newAccount.error.currency"),
        error: taken(e) ? t("newAccount.error.currency.taken") : null,
      },
      {
        id: `extra-${e.key}-amount`,
        label: t("newAccount.balance"),
        step: EXTRA,
        required: true,
        empty: e.amount === null && !e.amountProblem,
        emptyError: t("newAccount.error.balance.empty"),
        error: e.amountProblem || unfit(e.amount, e.currency) ? t("newAccount.balance") : null,
      },
    ]),
    { id: "note", label: t("newAccount.note"), step: EXTRA, empty: v.note.trim() === "" },
  ];

  const submit = async () => {
    if (busy) return;
    const body = bodyOf(v, banks);
    const text = JSON.stringify(body);
    // The same request keeps its key on a retry (ARC-07 FR 4); a changed request takes a new one.
    if (sent.current?.body !== text) sent.current = { body: text, key: newIdempotencyKey() };
    setBusy(true);
    setFailure(null);
    const o = await outcome(
      api.POST("/v1/accounts", { params: { header: { "Idempotency-Key": sent.current.key } }, body }),
    );
    setBusy(false);
    if (o.ok) {
      onCreated(o.data.id);
      return;
    }
    if (o.kind === "network") {
      setFailure({ key: "newAccount.error.network" });
      return;
    }
    if (o.problem.code === "ACCOUNT_DUPLICATE") {
      // FR 25 on the save path: the check failed or was still running. The same text under «Номер» until the
      // number, institution or currency changes; the check runs again for the existing account's «Відкрити наявний».
      const number = normalNumber(v.number);
      setRefused({
        key: duplicateKey,
        text: t("newAccount.duplicate", { institution: institution?.name ?? "—", last4: number.slice(-4) }),
      });
      recheck();
      return;
    }
    setFailure({ key: "newAccount.error.save", code: o.supportId });
  };

  const typeHint = `${t(KIND_DESCRIPTION[kind])} · ${t("newAccount.type.more")}`;
  const extraHint =
    kind === "loan"
      ? t("newAccount.extra.hint.loan", {
          name: v.name.trim(),
          amount: v.balance !== null && v.currency ? formatMoney(locale, v.balance, v.currency) : "—",
        })
      : t("newAccount.extra.hint", { type: t(KIND_LABEL[kind]) });

  const bankGroups = [
    {
      id: "banks",
      title: "",
      options: [...banks.map((b) => ({ value: b.code, label: b.name }))],
    },
  ];

  const step = (form: FormDialogState) => {
    if (form.step === MAIN)
      return (
        <>
          <Select
            label={t("newAccount.type")}
            required
            value={kind}
            hint={typeHint}
            onChange={(k) => set("kind", k as AccountKind)}
            options={KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))}
          />
          <Field
            label={t("newAccount.name")}
            required
            value={v.name}
            placeholder={t("newAccount.name.placeholder")}
            onChange={(x) => set("name", x)}
            onBlur={form.leave("name")}
            error={form.errorOf("name")}
          />
          {other ? (
            <div className="newacc-pair newacc-pair--back">
              <Field
                label={t("newAccount.institution.otherName")}
                required
                value={v.otherName}
                onChange={(x) => set("otherName", x)}
                onBlur={form.leave("otherName")}
                error={form.errorOf("otherName")}
              />
              <SearchSelect
                label={t("newAccount.institution.country")}
                required
                value={v.country}
                groups={[{ id: "countries", title: "", options: countries }]}
                onChange={(c) => set("country", c)}
                error={form.errorOf("country")}
              />
              <IconButton
                icon="close"
                className="newacc-back"
                label={t("newAccount.institution.back")}
                onClick={() => setV((old) => ({ ...old, bank: "", otherName: "", country: "" }))}
              />
            </div>
          ) : (
            <SearchSelect
              label={t("newAccount.institution")}
              value={v.bank}
              groups={bankGroups}
              loading={banksLoading}
              hint={t("newAccount.institution.source")}
              searchLabel={t("newAccount.institution.search")}
              nothingFound={t("newAccount.institution.nothing")}
              showLeading={false}
              onChange={(code) => set("bank", code)}
              create={{
                label: t("newAccount.institution.other"),
                onCreate: () => setV((old) => ({ ...old, bank: OTHER_INSTITUTION })),
              }}
            />
          )}
        </>
      );
    if (form.step === BALANCE)
      return (
        <>
          <div className="newacc-pair newacc-pair--amount">
            <AmountField
              label={t(debt ? "newAccount.balance.debt" : "newAccount.balance")}
              required
              currency={v.currency || "EUR"}
              places={placesOf(v.currency)}
              {...(v.currency ? {} : { suffix: null })}
              value={v.balance}
              hint={debt ? t("newAccount.balance.debtHint") : undefined}
              onChange={(value, problem) =>
                setV((old) => ({ ...old, balance: value, balanceProblem: problem !== null }))
              }
              onBlur={form.leave("balance")}
              error={v.balanceProblem ? undefined : form.errorOf("balance")}
            />
            <Select
              label={t("newAccount.currency")}
              required
              value={v.currency}
              options={CURRENCY_OPTIONS}
              onChange={(c) => set("currency", c)}
              error={form.errorOf("currency")}
            />
          </div>
          <DateField
            label={t("newAccount.date")}
            required
            value={v.date}
            today={today}
            onChange={(d) => set("date", d)}
            error={form.errorOf("date")}
          />
        </>
      );
    const numberField = (
      <Field
        label={t("newAccount.number")}
        value={v.number}
        hint={hasCardNumber(kind) ? t("newAccount.number.hint") : undefined}
        onChange={(x) => set("number", x)}
        onBlur={form.leave("number")}
        error={form.errorOf("number") ?? duplicateText}
      />
    );
    const noteField = (
      <Field
        label={t("newAccount.note")}
        value={v.note}
        placeholder={t("newAccount.note.placeholder")}
        maxLength={NOTE_MAX}
        counter
        onChange={(x) => set("note", x)}
        onBlur={form.leave("note")}
      />
    );
    return (
      <>
        {kind === "loan" ? (
          // «Кредит» has two required fields and the split note on this step: number and note share a row to fit.
          <div className="newacc-pair newacc-pair--end">
            {numberField}
            {noteField}
          </div>
        ) : (
          numberField
        )}
        {duplicate ? (
          <div className="newacc-duplicate">
            <Button
              size="sm"
              label={t("newAccount.duplicate.open")}
              href={hrefFor(accountPath(duplicate.accountId))}
            />
          </div>
        ) : null}
        {hasRate(kind) || hasMonthly(kind) ? (
          <div className={hasMonthly(kind) ? "newacc-pair" : undefined}>
            {hasRate(kind) ? (
              <Field
                label={t("newAccount.rate")}
                required={kind === "loan"}
                value={v.rate}
                inputMode="decimal"
                onChange={(x) => set("rate", x)}
                onBlur={form.leave("rate")}
                error={form.errorOf("rate")}
              />
            ) : null}
            {hasMonthly(kind) ? (
              <AmountField
                label={t("newAccount.monthly")}
                required
                currency={v.currency || "EUR"}
                places={placesOf(v.currency)}
                value={v.monthly}
                onChange={(value, problem) =>
                  setV((old) => ({ ...old, monthly: value, monthlyProblem: problem !== null }))
                }
                onBlur={form.leave("monthly")}
                error={v.monthlyProblem ? undefined : form.errorOf("monthly")}
              />
            ) : null}
          </div>
        ) : null}
        {hasMonthly(kind) ? <p className="ws-form-hint">{t("newAccount.loan.note")}</p> : null}
        {hasDepositDates(kind) ? (
          <div className="newacc-pair">
            <DateField
              label={t("newAccount.openedOn")}
              value={v.openedOn}
              today={today}
              onChange={(d) => set("openedOn", d)}
            />
            <DateField
              label={t("newAccount.maturesOn")}
              value={v.maturesOn}
              today={today}
              onChange={(d) => set("maturesOn", d)}
              error={datesWrong ? t("newAccount.error.maturesOn") : undefined}
            />
          </div>
        ) : null}
        {hasCardTerms(kind) ? (
          <div className="newacc-pair">
            <AmountField
              label={t("newAccount.creditLimit")}
              currency={v.currency || "EUR"}
              places={placesOf(v.currency)}
              value={v.creditLimit}
              onChange={(value, problem) =>
                setV((old) => ({ ...old, creditLimit: value, creditLimitProblem: problem !== null }))
              }
              onBlur={form.leave("creditLimit")}
            />
            <Field
              label={t("newAccount.grace")}
              value={v.grace}
              inputMode="numeric"
              onChange={(x) => set("grace", x)}
              onBlur={form.leave("grace")}
              error={form.errorOf("grace")}
            />
          </div>
        ) : null}
        {hasExtraCurrencies(kind) ? (
          <ExtraCurrencies
            extras={v.extras}
            form={form}
            taken={taken}
            onChange={setExtra}
            onAdd={() =>
              setV((old) => ({
                ...old,
                extras: [
                  ...old.extras,
                  { key: nextKey.current++, currency: "", amount: null, amountProblem: false },
                ],
              }))
            }
            onRemove={(key) => setV((old) => ({ ...old, extras: old.extras.filter((e) => e.key !== key) }))}
          />
        ) : null}
        {kind === "loan" ? null : noteField}
      </>
    );
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("page.newAccount")}
      closeLabel={t("shell.close")}
      steps={[
        { label: t("newAccount.step.main") },
        { label: t("newAccount.step.balance") },
        { label: t("newAccount.step.extra") },
      ]}
      fields={fields}
      // Step 3 opens with its own hint (boards «Новий рахунок · крок 3», «Кредит»); a row of «+ додати ще валюту» has
      // required fields, so the form's «Поля з * обов’язкові.» is the hint then.
      hints={[undefined, undefined, kind === "loan" || extras.length === 0 ? extraHint : undefined]}
      submitLabel={t("newAccount.submit")}
      busy={busy}
      error={
        refused && refused.key === duplicateKey && !duplicate ? (
          <p>{refused.text}</p>
        ) : failure ? (
          <>
            <p>{t(failure.key)}</p>
            {failure.code ? <p>{t("newAccount.error.code", { code: failure.code })}</p> : null}
          </>
        ) : undefined
      }
      reason={{
        fill: (fields) => t("newAccount.reason.fill", { fields }),
        fix: (fields) => t("newAccount.reason.fix", { fields }),
        both: (empty, invalid) => t("newAccount.reason.both", { empty, invalid }),
      }}
      onSubmit={() => void submit()}
    >
      {step}
    </FormDialog>
  );
}

/**
 * «+ додати ще валюту» of a current account (FIN-01@PoC FR 12): a row per currency — currency, balance and «×»; its
 * opening balance is on the same «На дату» as the main currency (step 2).
 */
function ExtraCurrencies({
  extras,
  form,
  taken,
  onChange,
  onAdd,
  onRemove,
}: {
  extras: readonly ExtraCurrency[];
  form: FormDialogState;
  taken: (e: ExtraCurrency) => boolean;
  onChange: (key: number, change: Partial<ExtraCurrency>) => void;
  onAdd: () => void;
  onRemove: (key: number) => void;
}) {
  const t = useI18n().t;
  const full = extras.length >= EXTRAS_IN_FORM;
  return (
    <div className="newacc-extras">
      {extras.map((e) => (
        <div key={e.key} className="newacc-extra">
          <Select
            label={t("newAccount.currency")}
            required
            value={e.currency}
            options={CURRENCY_OPTIONS}
            onChange={(c) => onChange(e.key, { currency: c })}
            error={taken(e) ? t("newAccount.error.currency.taken") : form.errorOf(`extra-${e.key}-currency`)}
          />
          <AmountField
            label={t("newAccount.balance")}
            required
            currency={e.currency || "EUR"}
            places={placesOf(e.currency)}
            {...(e.currency ? {} : { suffix: null })}
            value={e.amount}
            onChange={(value, problem) => onChange(e.key, { amount: value, amountProblem: problem !== null })}
            onBlur={form.leave(`extra-${e.key}-amount`)}
            error={e.amountProblem ? undefined : form.errorOf(`extra-${e.key}-amount`)}
          />
          <IconButton
            icon="close"
            label={t("newAccount.removeCurrency", { currency: e.currency || "—" })}
            onClick={() => onRemove(e.key)}
          />
        </div>
      ))}
      {full ? null : (
        <div>
          <Button variant="quiet" size="sm" label={t("newAccount.addCurrency")} onClick={onAdd} />
        </div>
      )}
    </div>
  );
}
