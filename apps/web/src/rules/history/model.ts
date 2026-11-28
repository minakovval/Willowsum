import type { MessageKey } from "@willowsum/i18n";
import type { AccountRef } from "../api.ts";
import type {
  LabelAnswer,
  MappedGroup,
  MappedLabel,
  Mapping,
  Question,
  Recognition,
  ConfirmBody,
} from "./api.ts";

/**
 * BUD-21@PoC g): the user's corrections on «Перевірка розпізнавання» before «Підтвердити» (FR 6): they live on the screen
 * and go to the server in the one confirming request; nothing is created before it. Pure functions, no strings.
 */
export type Choice =
  | { readonly kind: "category"; readonly categoryId: string }
  | { readonly kind: "create" }
  | { readonly kind: "transfer" };

/** What the user changed: a label's mapping, «Показати категорію знову», the values counted as transfers, accounts. */
export interface Answers {
  readonly choices: ReadonlyMap<string, Choice>;
  /** A label whose «Інша наявна категорія…» is open and has no category yet. */
  readonly picking: ReadonlySet<string>;
  readonly show: ReadonlyMap<string, boolean>;
  readonly transfers: ReadonlySet<string> | null;
  readonly accounts: ReadonlyMap<string, string | null>;
  /** FR 6, AC9: the date question has been answered (the file is read again). */
  readonly dateAnswered: boolean;
}

export const NO_ANSWERS: Answers = {
  choices: new Map(),
  picking: new Set(),
  show: new Map(),
  transfers: null,
  accounts: new Map(),
  dateAnswered: false,
};

export const labelKey = (category: string | null, subcategory: string | null): string =>
  `${category ?? ""}\u0000${subcategory ?? ""}`;
const keyOf = (l: { category: string | null; subcategory: string | null }) =>
  labelKey(l.category, l.subcategory);

/** One row of the tree: a group of the file (a category with subcategories), a subcategory or a plain category. */
export type TreeRow =
  | { readonly kind: "group"; readonly group: MappedGroup }
  | { readonly kind: "label"; readonly label: MappedLabel; readonly nested: boolean };

/** The file's tree in the server's order: each category with subcategories first as a group, then its subcategories. */
export function treeRows(mapping: Mapping): TreeRow[] {
  const groups = new Map(mapping.groups.map((g) => [g.category, g]));
  const done = new Set<string>();
  const rows: TreeRow[] = [];
  for (const label of mapping.labels) {
    const group = label.subcategory !== null ? groups.get(label.category) : undefined;
    if (group && !done.has(group.category)) {
      done.add(group.category);
      rows.push({ kind: "group", group });
    }
    rows.push({ kind: "label", label, nested: label.subcategory !== null });
  }
  return rows;
}

/** The outcome of a label with the user's choice applied; `server` — what the server planned. */
export type Effective =
  | {
      readonly kind: "category";
      readonly categoryId: string;
      readonly name: string | null;
      readonly hidden: boolean;
    }
  | { readonly kind: "create"; readonly name: string | null; readonly kind2: "expense" | "income" }
  | { readonly kind: "transfer" }
  | { readonly kind: "skip" };

export function effectiveOf(
  label: MappedLabel,
  answers: Answers,
  nameOf: (categoryId: string) => string | null,
): Effective {
  const choice = answers.choices.get(keyOf(label));
  if (choice?.kind === "category")
    return {
      kind: "category",
      categoryId: choice.categoryId,
      name: nameOf(choice.categoryId),
      hidden: false,
    };
  if (choice?.kind === "transfer") return { kind: "transfer" };
  const o = label.outcome;
  if (choice?.kind === "create")
    return {
      kind: "create",
      name: label.subcategory ?? label.category,
      kind2: o.action === "create" ? o.kind : "expense",
    };
  if (o.action === "category")
    return { kind: "category", categoryId: o.categoryId, name: o.name, hidden: o.hidden };
  if (o.action === "create") return { kind: "create", name: o.name, kind2: o.kind };
  return o.action === "transfer" ? { kind: "transfer" } : { kind: "skip" };
}

/** FR 6: how many categories the confirmation creates — new groups of the file and labels that are created. */
export function createdCount(
  mapping: Mapping,
  answers: Answers,
  nameOf: (categoryId: string) => string | null,
): number {
  const groups = mapping.groups.filter((g) => g.target.kind === "new").length;
  const labels = mapping.labels.filter((l) => effectiveOf(l, answers, nameOf).kind === "create").length;
  return groups + labels;
}

/** A label that would be created with a name the space cannot have: the user has to map it before confirming. */
export const hasInvalidName = (
  mapping: Mapping,
  answers: Answers,
  nameOf: (categoryId: string) => string | null,
): boolean =>
  mapping.labels.some((l) => {
    const e = effectiveOf(l, answers, nameOf);
    return (
      e.kind === "create" &&
      l.outcome.action === "create" &&
      l.outcome.name === null &&
      !answers.choices.has(keyOf(l))
    );
  });

/** The questions of the step (FR 6): the ones the server asks about a label or a group; the answered ones go away. */
export interface Asked {
  readonly key: string;
  readonly question: Exclude<Question, "duplicate-name" | "name-invalid">;
  readonly label: MappedLabel | null;
  readonly group: MappedGroup | null;
}
export function questionsOf(mapping: Mapping): Asked[] {
  const asked: Asked[] = [];
  const keep = (q: Question): q is Asked["question"] => q !== "duplicate-name" && q !== "name-invalid";
  for (const g of mapping.groups)
    for (const q of g.questions.filter(keep))
      asked.push({ key: `g:${g.category}:${q}`, question: q, label: null, group: g });
  for (const l of mapping.labels)
    for (const q of l.questions.filter(keep))
      asked.push({ key: `l:${keyOf(l)}:${q}`, question: q, label: l, group: null });
  return asked;
}

/** FR 4: the sample and its two readings, when the engine only assumed the date order (`date-order-assumed`). */
export function dateQuestion(r: Recognition): { sample: string; first: number; second: number } | null {
  const dates = r.dates;
  if (!dates?.flags.includes("date-order-assumed")) return null;
  const cell = dates.chosen.examples
    .map((e) => e.cell)
    .find((c) => /^\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(c));
  const m = cell ? /^\s*(\d{1,2})[./-](\d{1,2})/.exec(cell) : null;
  if (!cell || !m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a >= 1 && a <= 12 && b >= 1 && b <= 12 ? { sample: cell.trim(), first: a, second: b } : null;
}

/** The roles the select offers, in the board's order; `ignore` is «Не використовувати». */
export const ROLE_OPTIONS = [
  "date",
  "amount",
  "description",
  "counterparty",
  "category",
  "subcategory",
  "transfer-flag",
  "tags",
  "account",
  "ignore",
] as const;
export type RoleOption = (typeof ROLE_OPTIONS)[number];
export const ROLE_KEYS: Readonly<Record<RoleOption, MessageKey>> = {
  date: "history.role.date",
  amount: "history.role.amount",
  description: "history.role.description",
  counterparty: "history.role.counterparty",
  category: "history.role.category",
  subcategory: "history.role.subcategory",
  "transfer-flag": "history.role.transfer",
  tags: "history.role.tags",
  account: "history.role.account",
  ignore: "history.role.ignore",
};

const fold = (s: string) => s.normalize("NFC").trim().toLocaleLowerCase("uk");
const accountName = (label: string) => label.replace(/\s+··\d+$/, "");

/** FR 5: the account of the space for a value of the file's account column — by name — or null (not matched). */
export function matchAccount(value: string, accounts: readonly AccountRef[]): string | null {
  const found = accounts.filter((a) => !a.closed && fold(accountName(a.label)) === fold(value));
  return found.length === 1 ? found[0]!.id : null;
}

export const accountOf = (
  value: string,
  answers: Answers,
  accounts: readonly AccountRef[],
): { id: string | null; byName: boolean } => {
  if (answers.accounts.has(value)) return { id: answers.accounts.get(value) ?? null, byName: false };
  const id = matchAccount(value, accounts);
  return { id, byName: id !== null };
};

/** The body of «Підтвердити і вивести правила»: only the user's choices, and every account value with its account. */
export function confirmBody(
  parseId: string,
  r: Recognition,
  answers: Answers,
  accounts: readonly AccountRef[],
): ConfirmBody {
  const labels: LabelAnswer[] = [];
  for (const l of r.mapping?.labels ?? []) {
    const key = keyOf(l);
    const choice = answers.choices.get(key);
    const shown = answers.show.get(key);
    const base = { category: l.category, subcategory: l.subcategory };
    if (choice?.kind === "category")
      labels.push({
        ...base,
        action: "category",
        categoryId: choice.categoryId,
        ...(shown !== undefined ? { show: shown } : {}),
      });
    else if (choice) labels.push({ ...base, action: choice.kind });
    else if (shown !== undefined && l.outcome.action === "category")
      labels.push({ ...base, action: "category", categoryId: l.outcome.categoryId, show: shown });
  }
  const transferValues = answers.transfers
    ? [...answers.transfers]
    : r.transfers.values.filter((v) => v.transfer).map((v) => v.value);
  return {
    parseId,
    transferValues,
    accounts: r.accounts.values.map((v) => ({
      value: v.value,
      accountId: accountOf(v.value, answers, accounts).id,
    })),
    ...(labels.length > 0 ? { labels } : {}),
  };
}
