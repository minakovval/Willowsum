import { formatNumber, type Locale, type MessageKey, type Translate } from "@willowsum/i18n";
import type { AccountItem, AccountRefusal, BatchDetail, FileParse } from "./api.ts";

/**
 * IMP-08@PoC a) (wave 2, row 136): the rows of the step «Рахунок і файли». A row is a file as the user sees it: still
 * uploading, refused before or after it reached the server (with the API's code), parsing, parsed with its account or
 * waiting for one. Pure: no request here, no money (a file is a name, a size, a row count and an account).
 */
export type Phase = "uploading" | "parsing" | "ready" | "needs-account" | "rejected" | "failed" | "network";

export interface FileRow {
  /** The batch file's id, or a local key while the file has none. */
  readonly key: string;
  readonly fileId: string | null;
  readonly name: string;
  readonly sizeBytes: number | null;
  readonly rowCount: number | null;
  readonly phase: Phase;
  readonly accountId: string | null;
  readonly recipeFormat: "match" | "changed" | "unknown" | null;
  /** The code of a refusal (upload or parse), or `null`. */
  readonly code: string | null;
  /** The API's own text of a refusal, `{uk, en}`, used for a code the catalogue does not know. */
  readonly message: { readonly uk: string; readonly en: string } | null;
  /** «Підтвердіть рахунок» (readiness): what the file shows against the chosen account and the best guess. */
  readonly refusal: AccountRefusal | null;
  /** What the statement says about its own account (bank, currency, «…» and 4 characters): `null` before the parse. */
  readonly detected: Detected | null;
}

/** `files[].detected` of the parse: the facts only when the file names them; the mask is already cut to 4 characters. */
export type Detected = NonNullable<FileParse["detected"]>;

/** A file that has no row on the server (yet or at all): being uploaded, refused by the picker or lost on the way. */
export interface Local {
  readonly key: string;
  readonly name: string;
  readonly size: number | null;
  /** The file to send again; `null` for a name the server refused without a row (a batch with no place left). */
  readonly file: File | null;
  readonly phase: "uploading" | "rejected" | "network";
  readonly code: string | null;
  readonly message: { readonly uk: string; readonly en: string } | null;
}

export interface Snapshot {
  readonly files: BatchDetail["fileList"];
  readonly parse: ReadonlyMap<string, FileParse>;
  readonly refusals: ReadonlyMap<string, AccountRefusal>;
  readonly locals: readonly Local[];
}

export function rowsOf(s: Snapshot): FileRow[] {
  const local: FileRow[] = s.locals.map((l) => ({
    key: l.key,
    fileId: null,
    name: l.name,
    sizeBytes: l.size,
    rowCount: null,
    phase: l.phase,
    accountId: null,
    recipeFormat: null,
    code: l.code,
    message: l.message,
    refusal: null,
    detected: null,
  }));
  const server: FileRow[] = s.files.map((f) => {
    const base = {
      key: f.id,
      fileId: f.id,
      name: f.fileName,
      sizeBytes: f.sizeBytes,
      rowCount: null,
      accountId: null,
      recipeFormat: null,
      code: null,
      message: null,
      refusal: null,
      detected: null,
    };
    if (f.status === "rejected") return { ...base, phase: "rejected" as const, code: f.rejectionCode };
    const p = s.parse.get(f.id);
    if (!p || p.state === "pending") return { ...base, phase: "parsing" as const };
    if (p.state === "failed")
      return {
        ...base,
        phase: "failed" as const,
        code: p.refusal?.code ?? null,
        message: p.refusal?.message ?? null,
      };
    const refusal = s.refusals.get(f.id) ?? null;
    return {
      ...base,
      rowCount: p.rowCount,
      accountId: p.accountId,
      recipeFormat: p.recipe?.format ?? null,
      refusal,
      detected: p.detected ?? null,
      phase: p.accountId === null || refusal !== null ? ("needs-account" as const) : ("ready" as const),
    };
  });
  return [...server, ...local];
}

export interface Counts {
  readonly ready: number;
  readonly parsing: number;
  readonly action: number;
  readonly failed: number;
}

export function countsOf(rows: readonly FileRow[]): Counts {
  const n = (...p: Phase[]) => rows.filter((r) => p.includes(r.phase)).length;
  return {
    ready: n("ready"),
    parsing: n("uploading", "parsing"),
    action: n("needs-account"),
    failed: n("rejected", "failed", "network"),
  };
}

/** Why «Далі» is not available yet, or `null` when it is (IMP-01 FR 6: a refused file does not stop the others). */
export function nextBlock(rows: readonly FileRow[]): "none" | "busy" | "account" | "failed" | null {
  const c = countsOf(rows);
  if (rows.length === 0) return "none";
  if (c.parsing > 0) return "busy";
  if (c.action > 0) return "account";
  if (c.ready === 0) return "failed";
  return null;
}

/** FR 2: a file's account is chosen among the active accounts; a credit card and a loan carry their mark. */
export interface Choice {
  readonly id: string;
  /** «Поточний ··4417» (DS-04 FR 13: the last four characters). */
  readonly label: string;
  readonly mark: "creditCard" | "loan" | null;
}

export function choicesOf(accounts: readonly AccountItem[]): Choice[] {
  return accounts.map((a) => ({
    id: a.id,
    label: a.number ? `${a.name} ··${a.number.last4}` : a.name,
    mark: a.kind === "credit-card" ? "creditCard" : a.kind === "loan" ? "loan" : null,
  }));
}

export function choiceLabel(t: Translate, c: Choice): string {
  return c.mark === null
    ? c.label
    : t("import.account.option", { account: c.label, mark: t(`import.account.mark.${c.mark}`) });
}

/** A size in bytes as «214 КБ» or «1,2 МБ» (binary steps, one decimal place at most; no money). */
export function sizeText(t: Translate, locale: Locale, bytes: number): string {
  const unit = bytes >= 1024 * 1024 ? "mb" : bytes >= 1024 ? "kb" : "b";
  const divisor = unit === "mb" ? 1024 * 1024 : unit === "kb" ? 1024 : 1;
  const tenths = Math.round((bytes * 10) / divisor);
  const value =
    tenths % 10 === 0 || unit === "b"
      ? String(Math.round(bytes / divisor))
      : `${Math.floor(tenths / 10)}.${tenths % 10}`;
  return t(`import.size.${unit}` as MessageKey, { value: formatNumber(locale, value) });
}

/** «186 рядків»: the plural form of the row count in the user's language (uk: one, few, many, other). */
export const rowsText = (t: Translate, locale: string, count: number): string => {
  const rule = new Intl.PluralRules(locale === "uk" ? "uk-UA" : "en-GB").select(count);
  const form = rule === "one" || rule === "few" || rule === "many" ? rule : "other";
  return t(`import.rows.${form}` as MessageKey, { count });
};

/**
 * IMP-08@PoC FR 2, AC 16, AC 17: «Створити рахунок» is offered for a file that waits for an account when no account of
 * the space fits what the statement names (`detected.accountMatch` «none»). The rule is the server's one
 * (import-sessions `accountFor`, row 230b): the card or IBAN tail first, the bank only when it has one account; the
 * step does not match accounts itself. A tail one account ends in is that account; several accounts that fit — the
 * person picks among them, no offer.
 */
export function canCreateFor(row: FileRow): boolean {
  return row.phase === "needs-account" && row.fileId !== null && row.detected?.accountMatch === "none";
}
