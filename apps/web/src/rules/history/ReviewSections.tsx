import {
  formatDate,
  formatMoney,
  useI18n,
  useT,
  type Locale,
  type MessageKey,
  type Translate,
} from "@willowsum/i18n";
import { Badge, Segmented, Select, type SelectOption } from "@willowsum/ui";
import type { AccountRef } from "../api.ts";
import type { Categories } from "../../transactions/review.ts";
import type { Mapping, Recognition, Reread } from "./api.ts";
import {
  accountOf,
  dateQuestion,
  effectiveOf,
  labelKey,
  questionsOf,
  ROLE_KEYS,
  ROLE_OPTIONS,
  treeRows,
  type Answers,
  type Asked,
  type Effective,
  type RoleOption,
} from "./model.ts";

/** The sections of S-299 «Перевірка розпізнавання» (canvas PocMoneyHistoryReview; texts PocMoneyHistoryReviewTexts). */
export type Change = (next: Partial<Answers>) => void;
interface Common {
  readonly rec: Recognition;
  readonly answers: Answers;
  readonly change: Change;
  /** The step is closed: confirmed, or an action is running. */
  readonly locked: boolean;
}

/** The first column's role select: «Позначити колонку» moves focus to it. */
export const FIRST_ROLE = "hist-role-first";

const isoOrRaw = (locale: Locale, d: string | null): string => {
  if (d === null) return "";
  try {
    return formatDate(locale, d);
  } catch {
    return d;
  }
};

const amountText = (locale: Locale, amount: string | null, currency: string | null): string => {
  if (amount === null) return "";
  try {
    return currency ? formatMoney(locale, amount, currency) : amount;
  } catch {
    return amount;
  }
};

function columnName(t: Translate, rec: Recognition, role: string): string {
  const c = rec.columns.find((x) => x.role.chosen.value === role);
  return c ? (c.header ?? t("history.role.column", { n: c.column })) : "";
}

/** FR 4, FR 5: the roles of the columns, the examples as read, the formats of the file. */
export function ReadSection({
  rec,
  locked,
  onReread,
}: Pick<Common, "rec" | "locked"> & { onReread: (body: Reread) => void }) {
  const { t, locale } = useI18n();
  const order = (rec.dates?.chosen.value as { order?: string } | undefined)?.order ?? "";
  const decimal =
    (rec.numbers?.chosen.value as { decimalSeparator?: string } | undefined)?.decimalSeparator ?? "";
  const sign = typeof rec.sign?.chosen.value === "string" ? rec.sign.chosen.value : "";
  const roleLabel = (r: string) =>
    r in ROLE_KEYS ? t(ROLE_KEYS[r as RoleOption]) : t("history.role.other", { role: r });
  const delimiterName: Readonly<Record<string, MessageKey>> = {
    ",": "history.delimiter.comma",
    ";": "history.delimiter.semicolon",
    "\t": "history.delimiter.tab",
    "|": "history.delimiter.pipe",
  };
  const delimiter = rec.delimiter?.chosen.value ?? "";
  return (
    <section className="ws-card hist-card" aria-labelledby="hist-read">
      <h2 id="hist-read" className="ws-text-heading-3">
        {t("history.read.title")}
      </h2>
      <p className="ws-muted">{t("history.read.hint")}</p>
      <div className="hist-columns">
        {rec.columns.map((c, i) => {
          const role = String(c.role.chosen.value);
          const known = role in ROLE_KEYS;
          const options: SelectOption[] = [
            ...ROLE_OPTIONS.map((r) => ({ value: r, label: t(ROLE_KEYS[r]) })),
            ...(known ? [] : [{ value: role, label: roleLabel(role), disabled: true }]),
          ];
          const ev = c.role.evidence.find((e) => e.count !== undefined && e.of !== undefined);
          const name = c.header ?? t("history.role.column", { n: c.column });
          return (
            <div key={c.column} className="hist-column">
              <Select
                label={name}
                className="hist-compact"
                options={options}
                value={role}
                disabled={locked}
                onChange={(value) => onReread({ columns: [{ column: c.column, role: value as never }] })}
                {...(i === 0 ? { id: FIRST_ROLE } : {})}
              />
              {ev ? (
                <p className="hist-evidence ws-muted">
                  {t("history.role.evidence", {
                    matched: ev.count ?? 0,
                    total: ev.of ?? 0,
                    role: roleLabel(role),
                  })}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="hist-table-wrap">
        <table className="hist-table">
          <caption className="ws-visually-hidden">{t("history.examples.caption")}</caption>
          <thead>
            <tr>
              {(
                [
                  "date",
                  "amount",
                  "description",
                  "category",
                  "subcategory",
                  "transfer",
                  "tags",
                  "account",
                ] as const
              ).map((r) => (
                <th key={r} scope="col">
                  {t(`history.role.${r}` as MessageKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rec.examples.map((e) => (
              <tr key={e.row}>
                <td>{isoOrRaw(locale, e.date)}</td>
                <td className="hist-num">{amountText(locale, e.amount, e.currency)}</td>
                <td className="hist-wrap">{e.description ?? e.counterparty ?? ""}</td>
                <td className="hist-wrap">{e.category ?? ""}</td>
                <td className="hist-wrap">{e.subcategory ?? ""}</td>
                <td>{e.transfer ? t("history.examples.transfer") : ""}</td>
                <td className="hist-wrap">{e.tags ?? ""}</td>
                <td className="hist-wrap">{e.account ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="hist-formats">
        <Select
          label={t("history.format.dates", {
            format: order ? t(`history.format.${order}` as MessageKey) : "",
          })}
          className="hist-format"
          options={(["dmy", "mdy", "ymd"] as const).map((o) => ({
            value: o,
            label: t(`history.format.${o}` as MessageKey),
          }))}
          value={order}
          disabled={locked}
          onChange={(value) => onReread({ dateOrder: value as "dmy" })}
        />
        <Select
          label={t("history.format.numbers", {
            format: decimal === "." ? t("history.format.numbers.dot") : t("history.format.numbers.comma"),
          })}
          className="hist-format"
          options={[
            { value: ",", label: t("history.format.numbers.comma") },
            { value: ".", label: t("history.format.numbers.dot") },
          ]}
          value={decimal}
          disabled={locked}
          onChange={(value) => onReread({ decimalSeparator: value as "," })}
        />
        <Select
          label={t("history.format.sign", {
            sign: sign === "invert" ? t("history.format.sign.invert") : t("history.format.sign.asPrinted"),
          })}
          className="hist-format"
          options={[
            { value: "as-printed", label: t("history.format.sign.asPrinted") },
            { value: "invert", label: t("history.format.sign.invert") },
          ]}
          value={sign}
          disabled={locked}
          onChange={(value) => onReread({ sign: value as "invert" })}
        />
      </div>
      <ul className="hist-structure ws-muted">
        {rec.encoding ? (
          <li>{t("history.format.encoding", { encoding: rec.encoding.chosen.value.toUpperCase() })}</li>
        ) : null}
        {rec.delimiter ? (
          <li>
            {t("history.format.delimiter", {
              delimiter: delimiterName[delimiter] ? t(delimiterName[delimiter]!) : delimiter,
            })}
          </li>
        ) : null}
        {rec.table.headerRow !== null ? (
          <li>{t("history.format.header", { row: rec.table.headerRow })}</li>
        ) : null}
      </ul>
    </section>
  );
}

/** FR 6: the uncertain decisions as questions with explicit answers (a radio group each, never by colour alone). */
export function QuestionsSection({
  rec,
  answers,
  change,
  locked,
  onReread,
}: Common & { onReread: (body: Reread) => void }) {
  const { t, locale } = useI18n();
  const date = dateQuestion(rec);
  const asked = rec.mapping ? questionsOf(rec.mapping) : [];
  if (!date && asked.length === 0) return null;
  const order = (rec.dates?.chosen.value as { order?: string } | undefined)?.order ?? "";
  const day = (n: number, m: number) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-GB", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2024, m - 1, n)));
  return (
    <section className="ws-card hist-card" aria-labelledby="hist-questions">
      <h2 id="hist-questions" className="ws-text-heading-3">
        {t("history.questions.title")}
      </h2>
      <ul className="hist-questions">
        {date ? (
          <li className="hist-question">
            <p>
              {t("history.question.dates", {
                sample: date.sample,
                dm: day(date.first, date.second),
                md: day(date.second, date.first),
              })}
            </p>
            <Segmented
              legend={t("history.format.dates", {
                format: order ? t(`history.format.${order}` as MessageKey) : "",
              })}
              options={(["dmy", "mdy"] as const).map((o) => ({
                value: o,
                label: t(`history.format.${o}` as MessageKey),
              }))}
              value={order}
              onChange={(value) => {
                if (locked) return;
                change({ dateAnswered: true });
                onReread({ dateOrder: value as "dmy" });
              }}
            />
          </li>
        ) : null}
        {asked.map((a) => (
          <QuestionRow key={a.key} asked={a} answers={answers} change={change} locked={locked} />
        ))}
      </ul>
    </section>
  );
}

function QuestionRow({
  asked,
  answers,
  change,
  locked,
}: {
  asked: Asked;
  answers: Answers;
  change: Change;
  locked: boolean;
}) {
  const t = useT();
  const label = asked.label;
  const key = label ? labelKey(label.category, label.subcategory) : "";
  const name = label ? (label.subcategory ?? label.category) : (asked.group?.category ?? "");
  if (asked.question === "hidden-category" && label) {
    const shown = answers.show.get(key);
    const text = t("history.question.hidden", { label: name });
    return (
      <li className="hist-question">
        <p>{text}</p>
        <Segmented
          legend={name}
          options={[
            { value: "show", label: t("history.question.hidden.show") },
            { value: "keep", label: t("history.question.hidden.keep") },
          ]}
          value={shown === undefined ? "" : shown ? "show" : "keep"}
          onChange={(v) => !locked && change({ show: new Map(answers.show).set(key, v === "show") })}
        />
      </li>
    );
  }
  if (asked.question === "opposite-sign" && label) {
    const mapping = answers.picking.has(key) || answers.choices.get(key)?.kind === "category";
    const text = t("history.question.opposite", {
      sub: label.subcategory ?? label.category,
      group: label.category,
    });
    return (
      <li className="hist-question">
        <p>{text}</p>
        <Segmented
          legend={label.subcategory ?? label.category}
          options={[
            { value: "keep", label: t("history.question.opposite.keep") },
            { value: "map", label: t("history.question.opposite.map") },
          ]}
          value={mapping ? "map" : "keep"}
          onChange={(v) => {
            if (locked) return;
            const picking = new Set(answers.picking);
            const choices = new Map(answers.choices);
            if (v === "map") picking.add(key);
            else {
              picking.delete(key);
              choices.delete(key);
            }
            change({ picking, choices });
          }}
        />
      </li>
    );
  }
  // «Знаки порівну» (EC 4): the type of the new category is «витрата»; the server takes no other answer yet.
  const text = t("history.question.signs", { label: name });
  return (
    <li className="hist-question">
      <p>{text}</p>
      <Segmented
        legend={name}
        options={[{ value: "expense", label: t("history.question.signs.expense") }]}
        value="expense"
        onChange={() => undefined}
      />
    </li>
  );
}

/** FR 5, FR 7: the file's categories with what happens to each, and the change of the mapping. */
export function TreeSection({
  rec,
  answers,
  change,
  locked,
  categories,
  nameOf,
}: Common & { categories: Categories | null; nameOf: (id: string) => string | null }) {
  const { t } = useI18n();
  const mapping = rec.mapping;
  const options: SelectOption[] = [...(categories?.groups ?? [])]
    .filter((g) => g.kind !== "service")
    .flatMap((g) => g.categories.map((c) => ({ value: c.id, label: c.name })));
  return (
    <section className="ws-card hist-card" aria-labelledby="hist-tree">
      <h2 id="hist-tree" className="ws-text-heading-3">
        {t("history.tree.title")}
      </h2>
      <p className="ws-muted">{t("history.tree.hint")}</p>
      <div className="hist-table-wrap">
        <table className="hist-table hist-tree">
          <thead>
            <tr>
              <th scope="col">{t("history.tree.colLabel")}</th>
              <th scope="col" className="hist-num">
                {t("history.tree.colRows")}
              </th>
              <th scope="col">{t("history.tree.colOutcome")}</th>
              <th scope="col">
                <span className="ws-visually-hidden">{t("history.tree.change")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {mapping
              ? treeRows(mapping).map((row) =>
                  row.kind === "group" ? (
                    <tr key={`g:${row.group.category}`} className="hist-group-row">
                      <th scope="row" className="hist-wrap">
                        {row.group.category}
                      </th>
                      <td className="hist-num">{row.group.rows}</td>
                      <td className="hist-wrap">
                        {row.group.target.kind === "new"
                          ? t("history.tree.createGroup", {
                              name: row.group.target.name ?? row.group.category,
                            })
                          : t("history.tree.matchGroup", {
                              name: row.group.target.name ?? row.group.category,
                            })}
                      </td>
                      <td />
                    </tr>
                  ) : (
                    <LabelRow
                      key={labelKey(row.label.category, row.label.subcategory)}
                      label={row.label}
                      nested={row.nested}
                      mapping={mapping}
                      answers={answers}
                      change={change}
                      locked={locked}
                      options={options}
                      nameOf={nameOf}
                    />
                  ),
                )
              : rec.labels.items.flatMap((l) => [
                  <tr key={l.category}>
                    <th scope="row" className="hist-wrap">
                      {l.category}
                    </th>
                    <td className="hist-num">{l.count}</td>
                    <td />
                    <td />
                  </tr>,
                  ...l.subcategories.map((s) => (
                    <tr key={`${l.category}/${s.name}`}>
                      <td className="hist-nested hist-wrap">{s.name}</td>
                      <td className="hist-num">{s.count}</td>
                      <td />
                      <td />
                    </tr>
                  )),
                ])}
          </tbody>
        </table>
      </div>
      {rec.labels.more || mapping?.more ? <p className="ws-muted">{t("history.tree.more")}</p> : null}
    </section>
  );
}

function outcomeText(
  t: Translate,
  label: Mapping["labels"][number],
  e: Effective,
  mapping: Mapping,
): { text: string; tone: "match" | "create" | "plain" | "problem" } {
  const own = label.subcategory ?? label.category;
  if (e.kind === "category") return { text: t("history.tree.match", { name: e.name ?? own }), tone: "match" };
  if (e.kind === "transfer") return { text: t("history.tree.transfer"), tone: "plain" };
  if (e.kind === "skip") return { text: t("history.tree.skip"), tone: "plain" };
  const o = label.outcome;
  if (o.action !== "create") return { text: t("history.tree.create", { name: own }), tone: "create" };
  if (o.name === null && e.name === null)
    return { text: t("history.tree.invalid", { name: own }), tone: "problem" };
  if (label.questions.includes("duplicate-name"))
    return { text: t("history.tree.duplicate", { name: own, group: label.category }), tone: "create" };
  const history = mapping.historyGroups.find((h) => h.kind === o.kind);
  const group =
    o.group.kind === "history"
      ? (o.group.name ??
        (history
          ? t("history.tree.historyGroup", { kind: t(`history.tree.kind.${history.kind}` as MessageKey) })
          : null))
      : o.group.name;
  return {
    text: group
      ? t("history.tree.createIn", { name: e.name ?? own, group })
      : t("history.tree.create", { name: e.name ?? own }),
    tone: "create",
  };
}

function LabelRow({
  label,
  nested,
  mapping,
  answers,
  change,
  locked,
  options,
  nameOf,
}: {
  label: Mapping["labels"][number];
  nested: boolean;
  mapping: Mapping;
  answers: Answers;
  change: Change;
  locked: boolean;
  options: SelectOption[];
  nameOf: (id: string) => string | null;
}) {
  const { t } = useI18n();
  const key = labelKey(label.category, label.subcategory);
  const e = effectiveOf(label, answers, nameOf);
  const choice = answers.choices.get(key);
  const picking = answers.picking.has(key) || choice?.kind === "category";
  const shown = label.subcategory ?? label.category;
  const out = outcomeText(t, label, e, mapping);
  const setChoice = (next: ReturnType<typeof answers.choices.get>) => {
    const choices = new Map(answers.choices);
    if (next) choices.set(key, next);
    else choices.delete(key);
    change({ choices });
  };
  const mode =
    e.kind === "category"
      ? "other"
      : e.kind === "create"
        ? "create"
        : e.kind === "transfer"
          ? "transfer"
          : "";
  return (
    <tr className={nested ? "hist-label-row hist-nested-row" : "hist-label-row"}>
      <th scope="row" className={nested ? "hist-nested hist-wrap" : "hist-wrap"}>
        {shown}
      </th>
      <td className="hist-num">{label.rows}</td>
      <td className="hist-wrap">
        <span className="hist-outcome" data-tone={out.tone}>
          {out.tone === "problem" ? <Badge tone="negative" label={out.text} /> : out.text}
        </span>
      </td>
      <td className="hist-change">
        <Select
          label={t("history.tree.changeFor", { label: shown })}
          className="hist-compact"
          placeholder={t("history.tree.change")}
          options={[
            { value: "create", label: t("history.tree.createNew") },
            { value: "transfer", label: t("history.tree.isTransfer") },
            { value: "other", label: t("history.tree.other") },
          ]}
          value={mode}
          disabled={locked}
          onChange={(v) => {
            const picks = new Set(answers.picking);
            if (v === "other") {
              picks.add(key);
              change({ picking: picks });
              return;
            }
            picks.delete(key);
            const choices = new Map(answers.choices);
            choices.set(key, { kind: v === "create" ? "create" : "transfer" });
            change({ picking: picks, choices });
          }}
        />
        {picking ? (
          <Select
            label={t("history.tree.pick", { label: shown })}
            className="hist-compact"
            placeholder={t("history.tree.other")}
            options={options}
            value={choice?.kind === "category" ? choice.categoryId : ""}
            disabled={locked}
            onChange={(id) => setChoice({ kind: "category", categoryId: id })}
          />
        ) : null}
      </td>
    </tr>
  );
}

/** FR 5, FR 8: the values of the transfer column the engine counts as transfers; the user changes them. */
export function TransfersSection({ rec, answers, change, locked }: Common) {
  const { t } = useI18n();
  if (rec.transfers.values.length === 0) return null;
  const on = answers.transfers ?? new Set(rec.transfers.values.filter((v) => v.transfer).map((v) => v.value));
  const flip = (value: string, checked: boolean) => {
    const next = new Set(on);
    if (checked) next.add(value);
    else next.delete(value);
    change({ transfers: next });
  };
  return (
    <section className="ws-card hist-card" aria-labelledby="hist-transfers">
      <h2 id="hist-transfers" className="ws-text-heading-3">
        {t("history.transfer.title")}
      </h2>
      <p className="ws-muted">
        {t("history.transfer.hint", { column: columnName(t, rec, "transfer-flag") })}
      </p>
      <ul className="hist-values">
        {rec.transfers.values.map((v) => (
          <li key={v.value}>
            <label className="hist-check">
              <input
                type="checkbox"
                checked={on.has(v.value)}
                disabled={locked}
                onChange={(e) => flip(v.value, e.target.checked)}
              />
              <span className="hist-wrap">«{v.value}»</span>
            </label>
            <span className="ws-muted">{t("history.transfer.count", { count: v.count })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** FR 5: the values of the account column with the account of the space for each, or «Не зіставлено». */
export function AccountsSection({
  rec,
  answers,
  change,
  locked,
  accounts,
}: Common & { accounts: readonly AccountRef[] }) {
  const { t } = useI18n();
  if (rec.accounts.values.length === 0) return null;
  const options = accounts.filter((a) => !a.closed).map((a) => ({ value: a.id, label: a.label }));
  return (
    <section className="ws-card hist-card" aria-labelledby="hist-accounts">
      <h2 id="hist-accounts" className="ws-text-heading-3">
        {t("history.accounts.title")}
      </h2>
      <p className="ws-muted">{t("history.accounts.hint", { column: columnName(t, rec, "account") })}</p>
      <ul className="hist-values">
        {rec.accounts.values.map((v) => {
          const a = accountOf(v.value, answers, accounts);
          return (
            <li key={v.value} className="hist-account">
              <span className="hist-wrap">«{v.value}»</span>
              <Select
                label={t("history.accounts.for", { value: v.value })}
                className="hist-compact"
                placeholder={t("history.accounts.choose")}
                options={options}
                value={a.id ?? ""}
                disabled={locked}
                onChange={(id) => change({ accounts: new Map(answers.accounts).set(v.value, id) })}
              />
              {a.id ? (
                a.byName ? (
                  <Badge tone="positive" label={t("history.accounts.matched")} />
                ) : null
              ) : (
                <>
                  <Badge tone="attention" label={t("history.accounts.unmatched")} />
                  <span className="ws-muted">{t("history.accounts.note")}</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** FR 5, EC 6: rows read and rows skipped with the reason. */
export function SummarySection({ rec }: { rec: Recognition }) {
  const { t } = useI18n();
  const s = rec.summary;
  const skipped = s.skipped.reduce((n, x) => n + x.count, 0);
  const reason: Readonly<Record<string, MessageKey>> = {
    "no-categorisation": "history.summary.noCategorisation",
    "service-category": "history.summary.service",
    "date-unreadable": "history.summary.date",
    "amount-unreadable": "history.summary.amount",
  };
  return (
    <section className="ws-card hist-card" aria-labelledby="hist-summary">
      <h2 id="hist-summary" className="ws-text-heading-3">
        {t("history.summary.title")}
      </h2>
      <p className="hist-strong">{t("history.summary.read", { count: s.read })}</p>
      <p className="hist-strong">{t("history.summary.skipped", { count: skipped })}</p>
      <ul>
        {s.skipped.map((x) =>
          reason[x.reason] ? <li key={x.reason}>{t(reason[x.reason]!, { count: x.count })}</li> : null,
        )}
      </ul>
      {s.tagsSkipped > 0 ? (
        <p className="ws-muted">{t("history.summary.tags", { count: s.tagsSkipped })}</p>
      ) : null}
    </section>
  );
}
