import { Decimal } from "@willowsum/domain-kernel";
import { dotted, slashed } from "./calendar.ts";
import { encodeCp1251 } from "./cp1251.ts";
import type { FamilyAccount, FamilyLedger, FamilyTransaction, RevertedOperation } from "./model.ts";
import { date, num, text, xlsx, type XlsxCell } from "./xlsx.ts";

/**
 * Statement files of the family's banks (IMP-01 FR 3: CSV and XLSX; IMP-06: encodings, delimiters, header
 * blocks, debit/credit columns, summary rows; IMP-10 FR 11: monobank, Revolut, BBVA, Raiffeisen UA). The
 * layouts follow the shape of what each bank exports, approximately: when a bank's library template lands
 * (IMP-10), its sample is aligned with the real column set there. One file per account and calendar year.
 */
const BOM = "\u{FEFF}";

export type StatementRow =
  | { readonly row: number; readonly transaction: string }
  /** A line inside the table that is not a transaction: a reverted payment or a totals line. */
  | { readonly row: number; readonly skip: "reverted" | "summary" };

export interface StatementFile {
  readonly path: string;
  readonly bank: FamilyAccount["bank"];
  readonly account: string;
  readonly format: "csv" | "xlsx";
  readonly encoding: "utf-8-bom" | "utf-8" | "windows-1251" | null;
  readonly delimiter: "," | ";" | null;
  readonly sheet: string | null;
  /** 1-based line (CSV) or sheet row (XLSX) of the column headers. */
  readonly headerRow: number;
  readonly order: "oldest-first" | "newest-first";
  readonly from: string;
  readonly to: string;
  readonly openingBalance: string;
  readonly closingBalance: string;
  /** Every line after the header that the importer reads, mapped to the ledger. */
  readonly rows: readonly StatementRow[];
}

export interface RenderedStatement {
  readonly file: StatementFile;
  readonly bytes: Buffer;
}

function csvLine(fields: readonly string[], delimiter: string, quoteAll: boolean): string {
  return fields
    .map((f) => (quoteAll || f.includes(delimiter) || f.includes('"') || /[\r\n]/.test(f) ? `"${f.replaceAll('"', '""')}"` : f))
    .join(delimiter);
}

/** «-12345.60» → «-12 345,60» (Ukrainian bank style: space for thousands, comma for decimals). */
function uaNumber(value: string): string {
  const negative = value.startsWith("-");
  const [whole, fraction] = value.replace("-", "").split(".") as [string, string];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${negative ? "-" : ""}${grouped},${fraction}`;
}

interface Slice {
  readonly year: number;
  readonly from: string;
  readonly to: string;
  readonly opening: string;
  readonly closing: string;
  readonly transactions: readonly FamilyTransaction[];
  readonly reverted: readonly RevertedOperation[];
}

const chronological = (a: { date: string; time: string }, b: { date: string; time: string }) =>
  a.date === b.date ? (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) : a.date < b.date ? -1 : 1;

/** The account's transactions cut by calendar year, with the balance before and after each year. */
function slices(ledger: FamilyLedger, account: FamilyAccount): Slice[] {
  const own = ledger.transactions.filter((t) => t.account === account.id);
  const reverted = ledger.reverted.filter((r) => r.account === account.id);
  const first = Number.parseInt(ledger.from.slice(0, 4), 10);
  const last = Number.parseInt(ledger.to.slice(0, 4), 10);
  const result: Slice[] = [];
  let opening = account.openingBalance;
  for (let year = first; year <= last; year++) {
    const from = year === first ? ledger.from : `${year}-01-01`;
    const to = year === last ? ledger.to : `${year}-12-31`;
    const transactions = own.filter((t) => t.date >= from && t.date <= to);
    const closing = transactions.length > 0 ? transactions[transactions.length - 1]!.balanceAfter : opening;
    result.push({
      year,
      from,
      to,
      opening,
      closing,
      transactions,
      reverted: reverted.filter((r) => r.date >= from && r.date <= to),
    });
    opening = closing;
  }
  return result;
}

function base(account: FamilyAccount, slice: Slice, path: string) {
  return {
    path,
    bank: account.bank,
    account: account.id,
    from: slice.from,
    to: slice.to,
    openingBalance: slice.opening,
    closingBalance: slice.closing,
  };
}

/** monobank: UTF-8 with BOM, every field quoted, newest first, card and operation amounts, rate. */
function monobank(account: FamilyAccount, slice: Slice): RenderedStatement {
  const lines = [
    csvLine(
      [
        "Дата i час операції",
        "Деталі операції",
        "MCC",
        `Сума в валюті картки (${account.currency})`,
        "Сума в валюті операції",
        "Валюта",
        "Курс",
        `Сума комісій (${account.currency})`,
        `Сума кешбеку (${account.currency})`,
        "Залишок після операції",
      ],
      ",",
      true,
    ),
  ];
  const rows: StatementRow[] = [];
  for (const t of [...slice.transactions].reverse()) {
    lines.push(
      csvLine(
        [
          `${dotted(t.date)} ${t.time}`,
          t.description,
          t.mcc ?? "",
          t.amount,
          t.operationAmount ?? t.amount,
          t.operationCurrency ?? t.currency,
          t.rate ?? "—",
          "—",
          "—",
          t.balanceAfter,
        ],
        ",",
        true,
      ),
    );
    rows.push({ row: lines.length, transaction: t.id });
  }
  return {
    file: {
      ...base(account, slice, `monobank/${account.id}-${slice.year}.csv`),
      format: "csv",
      encoding: "utf-8-bom",
      delimiter: ",",
      sheet: null,
      headerRow: 1,
      order: "newest-first",
      rows,
    },
    bytes: Buffer.from(`${BOM}${lines.join("\n")}\n`, "utf8"),
  };
}

const REVOLUT_TYPE: Readonly<Record<FamilyTransaction["type"], string>> = {
  card: "CARD_PAYMENT",
  income: "TOPUP",
  bill: "CARD_PAYMENT",
  transfer: "TOPUP",
  exchange: "EXCHANGE",
  interest: "FEE",
};

/** Revolut: UTF-8, oldest first, one file per currency pocket; reverted payments have no balance. */
function revolut(account: FamilyAccount, slice: Slice): RenderedStatement {
  const lines = ["Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance"];
  const rows: StatementRow[] = [];
  const entries = [
    ...slice.transactions.map((t) => ({ kind: "tx" as const, date: t.date, time: t.time, t })),
    ...slice.reverted.map((r) => ({ kind: "reverted" as const, date: r.date, time: r.time, r })),
  ].sort(chronological);
  for (const e of entries) {
    if (e.kind === "tx") {
      const t = e.t;
      const type = t.type === "transfer" && t.amount.startsWith("-") ? "TRANSFER" : REVOLUT_TYPE[t.type];
      lines.push(
        csvLine(
          [type, "Current", `${t.date} ${t.time}`, `${t.postedDate} ${t.time}`, t.description, t.amount, "0.00", t.currency, "COMPLETED", t.balanceAfter],
          ",",
          false,
        ),
      );
      rows.push({ row: lines.length, transaction: t.id });
    } else {
      const r = e.r;
      lines.push(
        csvLine(["CARD_PAYMENT", "Current", `${r.date} ${r.time}`, "", r.description, r.amount, "0.00", r.currency, "REVERTED", ""], ",", false),
      );
      rows.push({ row: lines.length, skip: "reverted" });
    }
  }
  return {
    file: {
      ...base(account, slice, `revolut/${account.id}-${slice.year}.csv`),
      format: "csv",
      encoding: "utf-8",
      delimiter: ",",
      sheet: null,
      headerRow: 1,
      order: "oldest-first",
      rows,
    },
    bytes: Buffer.from(`${lines.join("\n")}\n`, "utf8"),
  };
}

const BBVA_MOVEMENT: Readonly<Record<FamilyTransaction["type"], string>> = {
  card: "Pago con tarjeta",
  income: "Nómina",
  bill: "Recibo",
  transfer: "Transferencia",
  exchange: "Cambio de divisa",
  interest: "Intereses",
};

/** BBVA current account: XLSX with a title block, real date and number cells, newest first. */
function bbvaCurrent(account: FamilyAccount, slice: Slice): RenderedStatement {
  const sheet: XlsxCell[][] = [
    [text("Últimos movimientos")],
    [text("Cuenta"), text(account.iban!.replace(/(.{4})/g, "$1 ").trim())],
    [text("Periodo"), text(`${slashed(slice.from)} - ${slashed(slice.to)}`)],
    [],
    ["F.Valor", "Fecha", "Concepto", "Movimiento", "Importe", "Divisa", "Disponible", "Divisa", "Observaciones"].map(text),
  ];
  const headerRow = sheet.length;
  const rows: StatementRow[] = [];
  for (const t of [...slice.transactions].reverse()) {
    const movement = t.type === "transfer" && t.amount.startsWith("-") ? "Transferencia realizada" : BBVA_MOVEMENT[t.type];
    sheet.push([
      date(t.postedDate),
      date(t.date),
      text(t.description),
      text(movement),
      num(t.amount),
      text(t.currency),
      num(t.balanceAfter),
      text(t.currency),
      t.mcc ? text(`Tarjeta ${account.cardMask!.slice(-4)}`) : null,
    ]);
    rows.push({ row: sheet.length, transaction: t.id });
  }
  return {
    file: {
      ...base(account, slice, `bbva/${account.id}-${slice.year}.xlsx`),
      format: "xlsx",
      encoding: null,
      delimiter: null,
      sheet: "Movimientos",
      headerRow,
      order: "newest-first",
      rows,
    },
    bytes: xlsx("Movimientos", sheet),
  };
}

/** BBVA loan: XLSX, oldest first; «Capital pendiente» is the outstanding debt (a positive number). */
function bbvaLoan(account: FamilyAccount, slice: Slice): RenderedStatement {
  const sheet: XlsxCell[][] = [
    [text("Detalle de préstamo")],
    [text("Contrato"), text(account.contract!)],
    [text("Periodo"), text(`${slashed(slice.from)} - ${slashed(slice.to)}`)],
    [],
    ["Fecha", "Concepto", "Importe", "Divisa", "Capital pendiente"].map(text),
  ];
  const headerRow = sheet.length;
  const rows: StatementRow[] = [];
  for (const t of slice.transactions) {
    sheet.push([date(t.date), text(t.description), num(t.amount), text(t.currency), num(new Decimal(t.balanceAfter).negated().toFixed(2))]);
    rows.push({ row: sheet.length, transaction: t.id });
  }
  return {
    file: {
      ...base(account, slice, `bbva/${account.id}-${slice.year}.xlsx`),
      format: "xlsx",
      encoding: null,
      delimiter: null,
      sheet: "Préstamo",
      headerRow,
      order: "oldest-first",
      rows,
    },
    bytes: xlsx("Préstamo", sheet),
  };
}

/**
 * Raiffeisen UA: Windows-1251 without BOM, «;», CRLF, a header block above the table, separate debit and credit
 * columns, «1 234,56» numbers, and totals lines under the table.
 */
function raiffeisen(account: FamilyAccount, slice: Slice): RenderedStatement {
  const lines = [
    csvLine(["Виписка по рахунку", account.iban!], ";", false),
    csvLine(["Період", `${dotted(slice.from)} - ${dotted(slice.to)}`], ";", false),
    csvLine(["Валюта", account.currency], ";", false),
    csvLine(["Вхідний залишок", uaNumber(slice.opening)], ";", false),
    csvLine(["Дата операції", "Дата проведення", "Опис операції", "Дебет", "Кредит", "Залишок"], ";", false),
  ];
  const headerRow = lines.length;
  const rows: StatementRow[] = [];
  let debit = new Decimal("0");
  let credit = new Decimal("0");
  for (const t of slice.transactions) {
    const amount = new Decimal(t.amount);
    const out = amount.isNegative();
    if (out) debit = debit.minus(amount);
    else credit = credit.plus(amount);
    lines.push(
      csvLine(
        [
          dotted(t.date),
          dotted(t.postedDate),
          t.description,
          out ? uaNumber(amount.negated().toFixed(2)) : "",
          out ? "" : uaNumber(t.amount),
          uaNumber(t.balanceAfter),
        ],
        ";",
        false,
      ),
    );
    rows.push({ row: lines.length, transaction: t.id });
  }
  lines.push(csvLine(["Обороти", "", "", uaNumber(debit.toFixed(2)), uaNumber(credit.toFixed(2)), ""], ";", false));
  rows.push({ row: lines.length, skip: "summary" });
  lines.push(csvLine(["Вихідний залишок", "", "", "", "", uaNumber(slice.closing)], ";", false));
  rows.push({ row: lines.length, skip: "summary" });
  return {
    file: {
      ...base(account, slice, `raiffeisen-ua/${account.id}-${slice.year}.csv`),
      format: "csv",
      encoding: "windows-1251",
      delimiter: ";",
      sheet: null,
      headerRow,
      order: "oldest-first",
      rows,
    },
    bytes: encodeCp1251(`${lines.join("\r\n")}\r\n`),
  };
}

export function statements(ledger: FamilyLedger): RenderedStatement[] {
  const out: RenderedStatement[] = [];
  for (const account of ledger.accounts) {
    const render =
      account.bank === "monobank"
        ? monobank
        : account.bank === "revolut"
          ? revolut
          : account.bank === "raiffeisen-ua"
            ? raiffeisen
            : account.kind === "loan"
              ? bbvaLoan
              : bbvaCurrent;
    for (const slice of slices(ledger, account)) out.push(render(account, slice));
  }
  return out;
}
