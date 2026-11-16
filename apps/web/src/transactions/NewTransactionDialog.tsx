import { useMemo, useState, type ReactNode } from "react";
import { newIdempotencyKey } from "@willowsum/api-contract";
import { formatLocaleOf, useI18n, useT, type MessageKey } from "@willowsum/i18n";
import {
  AmountField,
  CategorySelect,
  DateField,
  Dialog,
  Field,
  Icon,
  merchantInitials,
  SearchSelect,
  Select,
  Stepper,
  type CategoryChoice,
  type DialogAction,
  type SearchGroup,
  type StepState,
} from "@willowsum/ui";
import { useAuthApi } from "../auth/api.ts";
import { maskedNumber } from "../accounts/format.ts";
import { kyivToday } from "../recurring/data.ts";
import { IMPORT_WIZARD_PATH } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import {
  ACCOUNT_KINDS,
  createAccount,
  createCategory,
  isZero,
  saveTransaction,
  tagNames,
  useFormChoices,
  type Account,
  type AccountKind,
  type CategoryGroup,
  type SaveFailure,
  type Transaction,
  type TxStatus,
  type TxType,
} from "./newTransaction.ts";
import "./newTransaction.css";

export interface NewTransactionDialogProps {
  open: boolean;
  onClose: () => void;
  /** The saved transaction (the list or the account card refreshes). */
  onCreated?: ((transaction: Transaction) => void) | undefined;
  /** «Нова транзакція» on an account card: that account is filled in (FR 1). */
  accountId?: string | undefined;
  /** «Сьогодні» of the space; until the API gives it (wave 2 rows 176–178) — Kyiv, as the server counts it now. */
  today?: string | undefined;
}

/**
 * S-048 «Нова транзакція» (FIN-03@PoC FR 1, FR 2, FR 28, FR 29, FR 32): the create-form dialog in three steps —
 * «1 Основне · 2 Контрагент і категорія · 3 Додатково». Every required field is on step 1, so the transaction can be
 * added from it; steps not opened keep their defaults (no counterparty or category, «Проведена»).
 */
export function NewTransactionDialog(props: NewTransactionDialogProps) {
  // The lists load when the dialog opens, and the form starts empty each time.
  return props.open ? <NewTransactionForm {...props} /> : null;
}

const STEPS = ["newTx.step.main", "newTx.step.party", "newTx.step.more"] as const;
const COUNT_FORMS = ["one", "few", "many", "other"] as const;
const CURRENCIES = ["EUR", "UAH", "USD", "PLN", "GBP", "CHF"] as const;
type Mode = "form" | "account" | "category";

/** A subaccount of the list: one currency of an account (FR 28: the currency comes from the account). */
const choiceValue = (accountId: string, currency: string) => `${accountId}|${currency}`;
const parseChoice = (value: string) => {
  const [accountId = "", currency = ""] = value.split("|");
  return { accountId, currency };
};
const firstChoice = (accounts: readonly Account[], preferred?: string) => {
  const account = accounts.find((a) => a.id === preferred) ?? accounts[0];
  const currency = account?.currencies[0]?.currency;
  return account && currency ? choiceValue(account.id, currency) : "";
};

/** CMP-03 «Категорії»: the circle takes the palette tone of its group (the API's own shades are not tokens). */
const GROUP_TONES = 8;

function NewTransactionForm({
  onClose,
  onCreated,
  accountId,
  today = kyivToday(),
}: NewTransactionDialogProps) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const choices = useFormChoices(api);
  // One key per content sent: a repeated press or a retry after a lost answer creates the transaction once; a
  // changed form (after «Валюта не відповідає рахунку») is a new request with a new key.
  const [sent, setSent] = useState<{ body: string; key: string } | null>(null);

  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState<ReadonlySet<number>>(new Set([0]));
  const [mode, setMode] = useState<Mode>("form");
  const [type, setType] = useState<TxType>("expense");
  const [amount, setAmount] = useState<string | null>(null);
  const [amountTouched, setAmountTouched] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [counterparty, setCounterparty] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState<TxStatus>("posted");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [partial, setPartial] = useState<Transaction | null>(null);

  const accounts = choices.accounts.kind === "ready" ? (choices.accounts.items ?? []) : [];
  // The given account, else the first one, until the user picks another (the board shows a filled «Рахунок»).
  const account = chosen ?? firstChoice(accounts, accountId);
  const { accountId: chosenAccount, currency } = parseChoice(account);

  const amountError =
    amountTouched && amount === null
      ? t("newTx.required")
      : amount !== null && isZero(amount)
        ? t("newTx.amount.zero")
        : null;
  const missing: string[] = [];
  if (amount === null || isZero(amount)) missing.push(t("newTx.amount"));
  if (!chosenAccount) missing.push(t("newTx.account"));
  if (!date || date > today) missing.push(t("newTx.date"));
  const valid = missing.length === 0;

  const go = (next: number) => {
    setStep(next);
    setVisited((v) => new Set([...v, next]));
  };
  const stepState = (index: number): StepState => {
    if (index === step) return "current";
    if (index === 0) return valid ? "done" : "error";
    if (!valid) return "unavailable";
    return visited.has(index) ? "done" : "available";
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setFailure(null);
    const input = {
      accountId: chosenAccount,
      currency,
      type,
      amount: amount ?? "",
      date,
      counterparty,
      categoryId,
      description,
      tags: tagNames(tags),
      status,
    };
    const body = JSON.stringify(input);
    const key = sent?.body === body ? sent.key : newIdempotencyKey();
    setSent({ body, key });
    const result = await saveTransaction(api, input, key);
    setBusy(false);
    if (result.kind === "failed") {
      setFailure(result.failure);
      return;
    }
    onCreated?.(result.transaction);
    if (result.kind === "partial") setPartial(result.transaction);
    else onClose();
  };

  if (partial) {
    return (
      <Dialog
        open
        onClose={onClose}
        title={t("newTx.title")}
        closeLabel={t("shell.close")}
        actions={[{ label: t("newTx.done"), onClick: onClose, variant: "primary" }]}
        error={<ErrorText text={t("newTx.partial")} />}
      />
    );
  }

  if (mode === "account")
    return (
      <QuickAccount
        today={today}
        onCancel={() => setMode("form")}
        onCreated={async (created) => {
          await choices.reloadAccounts();
          const code = created.currencies[0]?.currency;
          if (code) setChosen(choiceValue(created.id, code));
          setMode("form");
        }}
      />
    );
  if (mode === "category")
    return (
      <QuickCategory
        groups={choices.groups.filter((g) => g.kind === type)}
        onCancel={() => setMode("form")}
        onCreated={async (id) => {
          await choices.reloadCategories();
          setCategoryId(id);
          setMode("form");
        }}
      />
    );

  const actions: DialogAction[] = [{ label: t("newTx.cancel"), onClick: onClose }];
  if (step > 0) actions.push({ label: t("newTx.back"), onClick: () => go(step - 1) });
  if (step < STEPS.length - 1)
    actions.push({ label: t("newTx.next"), onClick: () => go(step + 1), disabled: !valid });
  actions.push({
    label: t("newTx.submit"),
    busyLabel: t("newTx.submitBusy"),
    onClick: () => void submit(),
    variant: "primary",
    disabled: !valid,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("newTx.title")}
      align="start"
      closeLabel={t("shell.close")}
      actions={actions}
      busy={busy}
      note={valid ? undefined : t("newTx.missing", { fields: missing.join(", ") })}
      error={failure ? <FailureText failure={failure} /> : undefined}
    >
      <div className="newtx">
        <Stepper
          label={t("newTx.steps")}
          steps={STEPS.map((s, i) => ({ label: t(s), state: stepState(i) }))}
          onSelect={go}
        />
        <div className="newtx-step">
          {step === 0 ? (
            <>
              <p className="newtx-hint">{t("newTx.hint.required")}</p>
              <Segmented
                legend={t("newTx.type")}
                name="newtx-type"
                value={type}
                onChange={(v) => {
                  setType(v);
                  setCategoryId("");
                }}
                options={[
                  { value: "expense", label: t("newTx.type.expense") },
                  { value: "income", label: t("newTx.type.income") },
                ]}
              />
              <AmountField
                label={t("newTx.amount")}
                required
                value={amount}
                currency={currency || "EUR"}
                hint={t("newTx.amount.hint")}
                error={amountError}
                onChange={(v) => setAmount(v)}
                onBlur={() => setAmountTouched(true)}
              />
              <AccountField
                state={choices.accounts}
                value={account}
                onChange={setChosen}
                onCreate={() => setMode("account")}
              />
              <DateField
                label={t("newTx.date")}
                required
                value={date}
                onChange={setDate}
                today={today}
                max={today}
                chips={[
                  { label: t("newTx.date.today"), value: today },
                  { label: t("newTx.date.yesterday"), value: yesterday(today) },
                ]}
                limitNote={t("newTx.date.limit")}
              />
              <a className="app-quiet-link" href={hrefFor(IMPORT_WIZARD_PATH)} onClick={onClose}>
                {t("action.importStatement")}
              </a>
            </>
          ) : step === 1 ? (
            <>
              <p className="newtx-hint">{t("newTx.hint.party")}</p>
              <CounterpartyField
                merchants={choices.merchants}
                value={counterparty}
                onChange={setCounterparty}
                count={(n) => {
                  const rule = new Intl.PluralRules(formatLocaleOf(locale)).select(n);
                  const form = (COUNT_FORMS as readonly string[]).includes(rule) ? rule : "other";
                  return t(`newTx.counterparty.count.${form}` as MessageKey, { count: n });
                }}
              />
              <CategoryField
                groups={choices.groups}
                type={type}
                value={categoryId}
                onChange={setCategoryId}
                onCreate={() => setMode("category")}
              />
            </>
          ) : (
            <>
              <p className="newtx-hint">{t("newTx.hint.more")}</p>
              <Field
                label={t("newTx.description")}
                value={description}
                onChange={setDescription}
                placeholder={t("newTx.description.placeholder")}
                maxLength={1000}
              />
              <Field
                label={t("newTx.tags")}
                value={tags}
                onChange={setTags}
                placeholder={t("newTx.tags.placeholder")}
                hint={t("newTx.tags.hint")}
              />
              <Segmented
                legend={t("newTx.status")}
                visibleLegend
                name="newtx-status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "posted", label: t("newTx.status.posted") },
                  { value: "pending", label: t("newTx.status.pending") },
                ]}
              />
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

const yesterday = (iso: string): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** CMP-12 Segmented on native radios (arrows move the choice); the legend is hidden where the board shows none. */
function Segmented<V extends string>({
  legend,
  visibleLegend,
  name,
  value,
  onChange,
  options,
}: {
  legend: string;
  visibleLegend?: boolean;
  name: string;
  value: V;
  onChange: (value: V) => void;
  options: readonly { value: V; label: string }[];
}) {
  return (
    <fieldset className="ws-segmented">
      <legend className={visibleLegend ? "ws-segmented-legend" : "ws-visually-hidden"}>{legend}</legend>
      <div className="ws-segmented-options">
        {options.map((o) => (
          <label key={o.value} className="ws-segmented-option">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AccountField({
  state,
  value,
  onChange,
  onCreate,
}: {
  state: ReturnType<typeof useFormChoices>["accounts"];
  value: string;
  onChange: (value: string) => void;
  onCreate: () => void;
}) {
  const t = useT();
  if (state.kind === "loading")
    return (
      <SearchSelect label={t("newTx.account")} required loading groups={[]} value="" onChange={onChange} />
    );
  const accounts = state.items;
  if (accounts === null || accounts.length === 0) {
    // FR 32, AC17: no account yet (or the list failed) — the explanation and «Новий рахунок» in place of the list.
    return (
      <div className="newtx-noaccount">
        <SearchSelect
          label={t("newTx.account")}
          required
          groups={[]}
          value=""
          onChange={onChange}
          placeholder={t("newTx.account.placeholder")}
          hint={accounts === null ? t("newTx.account.loadError") : t("newTx.account.none")}
          disabled
        />
        <button type="button" className="ws-button ws-button-with-icon" onClick={onCreate}>
          <span className="ws-button-slot" aria-hidden="true">
            <Icon name="plus" size={16} inButton />
          </span>
          <span className="ws-button-label">{t("select.account.new")}</span>
        </button>
      </div>
    );
  }
  const option = (a: Account, currency: string) => {
    const masked = a.number ? maskedNumber(a.number.last4) : null;
    return {
      value: choiceValue(a.id, currency),
      label:
        masked && a.number ? t("select.account.masked", { name: a.name, last4: a.number.last4 }) : a.name,
      secondary: currency,
    };
  };
  const group = (id: "cash" | "credit"): SearchGroup => ({
    id,
    title: t(id === "cash" ? "accounts.group.cash" : "accounts.group.credit"),
    options: accounts
      .filter((a) => a.group === id)
      .flatMap((a) => a.currencies.map((c) => option(a, c.currency))),
  });
  return (
    <SearchSelect
      label={t("newTx.account")}
      required
      groups={[group("cash"), group("credit")]}
      value={value}
      onChange={onChange}
      placeholder={t("newTx.account.placeholder")}
      searchLabel={t("select.account.search")}
      create={{ label: t("select.account.new"), onCreate }}
    />
  );
}

/** FR 30: the space's known counterparties with their number of transactions, and «Додати «…» як нового контрагента». */
function CounterpartyField({
  merchants,
  value,
  onChange,
  count,
}: {
  merchants: readonly { id: string; name: string; transactionCount: number }[];
  value: string;
  onChange: (value: string) => void;
  count: (n: number) => string;
}) {
  const t = useT();
  const known = merchants.map((m) => ({
    value: m.name,
    label: m.name,
    secondary: count(m.transactionCount),
    leading: (
      <span className="newtx-initials" aria-hidden="true">
        {merchantInitials(m.name)}
      </span>
    ),
  }));
  const groups: SearchGroup[] = [{ id: "known", title: t("newTx.counterparty.known"), options: known }];
  if (value && !merchants.some((m) => m.name === value))
    groups.push({ id: "new", title: "", options: [{ value, label: value }] });
  return (
    <SearchSelect
      label={t("newTx.counterparty")}
      groups={groups}
      value={value}
      onChange={onChange}
      placeholder={t("newTx.counterparty.placeholder")}
      searchLabel={t("newTx.counterparty.search")}
      create={{
        label: (q) => t("newTx.counterparty.add", { name: q }),
        onCreate: (q) => {
          if (q) onChange(q);
        },
      }}
    />
  );
}

/** FR 31: the categories of the transaction's kind by their groups; «Нова категорія» always last. */
function CategoryField({
  groups,
  type,
  value,
  onChange,
  onCreate,
}: {
  groups: readonly CategoryGroup[];
  type: TxType;
  value: string;
  onChange: (value: string) => void;
  onCreate: () => void;
}) {
  const t = useT();
  const shown = useMemo(
    () =>
      groups
        .filter((g) => g.kind === type)
        .map((g, i) => ({
          id: g.id,
          title: g.name,
          categories: g.categories
            .filter((c) => !c.hidden)
            .map((c): CategoryChoice => ({
              value: c.id,
              label: c.name,
              color:
                type === "income"
                  ? `chart-group-income-${(i % 2) + 1}`
                  : `chart-cat-${(i % GROUP_TONES) + 1}`,
              icon: "budget",
            })),
        })),
    [groups, type],
  );
  return (
    <CategorySelect
      label={t("newTx.category")}
      value={value}
      onChange={onChange}
      top={[]}
      groups={shown}
      onCreate={onCreate}
      placeholder={t("transactionRow.uncategorized")}
    />
  );
}

function ErrorText({ text, code }: { text: string; code?: string | undefined }) {
  const t = useT();
  return (
    <p className="newtx-error">
      <strong>{t("field.error.word")}</strong> {text}
      {code ? <span className="newtx-code">{t("newTx.error.code", { code })}</span> : null}
    </p>
  );
}

const FAILURE_TEXT: Record<SaveFailure["kind"], MessageKey> = {
  currency: "newTx.error.currency",
  future: "newTx.error.future",
  closed: "newTx.error.closed",
  other: "newTx.error.save",
};

function FailureText({ failure }: { failure: SaveFailure }) {
  const t = useT();
  return (
    <ErrorText
      text={t(FAILURE_TEXT[failure.kind])}
      code={failure.kind === "other" ? failure.supportId : undefined}
    />
  );
}

/** The short form of FR 32 over the transaction form, in the same dialog: type, name, currency, balance today. */
function QuickAccount({
  today,
  onCancel,
  onCreated,
}: {
  today: string;
  onCancel: () => void;
  onCreated: (account: Account) => Promise<void>;
}) {
  const t = useT();
  const api = useAuthApi();
  const [kind, setKind] = useState<AccountKind>("current");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const missing = [
    !name.trim() && t("newTx.newAccount.name"),
    balance === null && t("newTx.newAccount.balance"),
  ]
    .filter(Boolean)
    .join(", ");

  const save = async () => {
    if (missing || balance === null || busy) return;
    setBusy(true);
    setError(null);
    const o = await createAccount(api, { kind, name, currency, balance, today });
    if (o.ok) {
      await onCreated(o.data);
      return;
    }
    setBusy(false);
    setError(
      <ErrorText text={t("newTx.error.save")} code={o.kind === "problem" ? o.supportId : undefined} />,
    );
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      title={t("newTx.newAccount.title")}
      align="start"
      closeLabel={t("shell.close")}
      busy={busy}
      error={error}
      note={missing ? t("newTx.missing", { fields: missing }) : undefined}
      actions={[
        { label: t("newTx.cancel"), onClick: onCancel },
        {
          label: t("newTx.newAccount.submit"),
          onClick: () => void save(),
          variant: "primary",
          disabled: Boolean(missing),
        },
      ]}
    >
      <div className="newtx-step">
        <Select
          label={t("newTx.newAccount.kind")}
          required
          value={kind}
          onChange={(v) => setKind(v as AccountKind)}
          options={ACCOUNT_KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))}
        />
        <Field
          label={t("newTx.newAccount.name")}
          required
          value={name}
          onChange={setName}
          placeholder={t("newTx.newAccount.name.placeholder")}
          maxLength={80}
        />
        <div className="newtx-pair">
          <AmountField
            label={t(kind === "loan" ? "newTx.newAccount.debt" : "newTx.newAccount.balance")}
            required
            value={balance}
            currency={currency}
            onChange={(v) => setBalance(v)}
          />
          <Select
            label={t("newTx.newAccount.currency")}
            required
            value={currency}
            onChange={setCurrency}
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
          />
        </div>
      </div>
    </Dialog>
  );
}

const KIND_LABEL: Record<AccountKind, MessageKey> = {
  current: "accounts.kind.current",
  savings: "accounts.kind.savings",
  deposit: "accounts.kind.deposit",
  cash: "accounts.kind.cash",
  "credit-card": "accounts.kind.creditCard",
  loan: "accounts.kind.loan",
};

/** «Нова категорія» (FR 31): a name and a group of the transaction's kind. */
function QuickCategory({
  groups,
  onCancel,
  onCreated,
}: {
  groups: readonly CategoryGroup[];
  onCancel: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const t = useT();
  const api = useAuthApi();
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const missing = [!name.trim() && t("newTx.newCategory.name"), !groupId && t("newTx.newCategory.group")]
    .filter(Boolean)
    .join(", ");

  const save = async () => {
    if (missing || busy) return;
    setBusy(true);
    setError(null);
    const o = await createCategory(api, { groupId, name });
    if (o.ok) {
      await onCreated(o.data.id);
      return;
    }
    setBusy(false);
    setError(
      <ErrorText text={t("newTx.error.save")} code={o.kind === "problem" ? o.supportId : undefined} />,
    );
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      title={t("newTx.newCategory.title")}
      align="start"
      closeLabel={t("shell.close")}
      busy={busy}
      error={error}
      note={missing ? t("newTx.missing", { fields: missing }) : undefined}
      actions={[
        { label: t("newTx.cancel"), onClick: onCancel },
        {
          label: t("newTx.newCategory.submit"),
          onClick: () => void save(),
          variant: "primary",
          disabled: Boolean(missing),
        },
      ]}
    >
      <div className="newtx-step">
        <Field label={t("newTx.newCategory.name")} required value={name} onChange={setName} maxLength={60} />
        <Select
          label={t("newTx.newCategory.group")}
          required
          value={groupId}
          onChange={setGroupId}
          options={groups.map((g) => ({ value: g.id, label: g.name }))}
        />
      </div>
    </Dialog>
  );
}
