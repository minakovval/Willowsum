import { createHash } from "node:crypto";
import { Decimal } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { encodeCp1251, excelSerial, generateFamily, type FamilyTruth, type RenderedStatement } from "./family/index.ts";

// ARC-03 FR 6: a family-scale synthetic dataset — 4 banks, 2–3 years, a credit card and a loan, transfers
// between the family's own accounts, several currencies — written as the banks' statement files (IMP-01,
// IMP-06, IMP-10: formats and banks) with the ground truth an importer must read from them.

const two = generateFamily({ seed: "willowsum", start: "2024-01-01", years: 2 });
const three = generateFamily({ seed: "willowsum", start: "2024-07-01", years: 3 });

const dec = (value: string) => new Decimal(value);
const byId = (truth: FamilyTruth) => new Map(truth.transactions.map((t) => [t.id, t]));

/** A CSV reader for the test (RFC 4180 quoting). */
function readCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line === "") continue;
    const fields: string[] = [];
    let i = 0;
    while (i <= line.length) {
      if (line[i] === '"') {
        let value = "";
        i++;
        for (;;) {
          const q = line.indexOf('"', i);
          if (line[q + 1] === '"') {
            value += `${line.slice(i, q)}"`;
            i = q + 2;
          } else {
            value += line.slice(i, q);
            i = q + 1;
            break;
          }
        }
        fields.push(value);
        i++; // delimiter
      } else {
        const end = line.indexOf(delimiter, i);
        fields.push(end === -1 ? line.slice(i) : line.slice(i, end));
        i = end === -1 ? line.length + 1 : end + 1;
      }
    }
    rows.push(fields);
  }
  return rows;
}

/** Reads a stored-method ZIP and returns its entries. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let p = 0;
  while (bytes.readUInt32LE(p) === 0x04034b50) {
    expect(bytes.readUInt16LE(p + 8)).toBe(0);
    const size = bytes.readUInt32LE(p + 18);
    const nameLength = bytes.readUInt16LE(p + 26);
    const extra = bytes.readUInt16LE(p + 28);
    const name = bytes.subarray(p + 30, p + 30 + nameLength).toString("utf8");
    const start = p + 30 + nameLength + extra;
    entries.set(name, bytes.subarray(start, start + size));
    p = start + size;
  }
  return entries;
}

type Cell = { style: string | null; type: string | null; value: string };
/** Sheet rows by 1-based row number; cells by column letter. */
function readSheet(bytes: Buffer): Map<number, Map<string, Cell>> {
  const xml = unzip(bytes).get("xl/worksheets/sheet1.xml")!.toString("utf8");
  const unescape = (s: string) =>
    s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  const rows = new Map<number, Map<string, Cell>>();
  for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"(?: s="(\d+)")?(?: t="(\w+)")?>(?:<is><t[^>]*>(.*?)<\/t><\/is>|<v>(.*?)<\/v>)<\/c>/g)) {
    const row = Number.parseInt(m[2]!, 10);
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row)!.set(m[1]!, { style: m[3] ?? null, type: m[4] ?? null, value: unescape(m[5] ?? m[6]!) });
  }
  return rows;
}

const fromSerial = (serial: string) =>
  new Date(Date.UTC(1899, 11, 30) + Number.parseInt(serial, 10) * 86_400_000).toISOString().slice(0, 10);
const fromDotted = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
const fromUa = (n: string) => (n === "" ? "0" : n.replaceAll(" ", "").replace(",", "."));

interface ReadRow {
  readonly row: number;
  readonly date: string;
  readonly amount: string;
  readonly currency: string;
  readonly balance: string | null;
  readonly state: string | null;
}

/** Reads a statement back the way a bank template would, independently of the generator's code. */
function readStatement({ file, bytes }: RenderedStatement): { rows: Map<number, ReadRow>; lastRow: number } {
  const rows = new Map<number, ReadRow>();
  let lastRow = 0;
  if (file.bank === "monobank") {
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const lines = readCsv(bytes.toString("utf8").slice(1), ",");
    const currency = /\((\w{3})\)/.exec(lines[0]![3]!)![1]!;
    lines.slice(1).forEach((f, i) =>
      rows.set(i + 2, { row: i + 2, date: fromDotted(f[0]!), amount: f[3]!, currency, balance: f[9]!, state: null }),
    );
    lastRow = lines.length;
  } else if (file.bank === "revolut") {
    const lines = readCsv(bytes.toString("utf8"), ",");
    expect(lines[0]).toEqual(["Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State", "Balance"]);
    lines.slice(1).forEach((f, i) =>
      rows.set(i + 2, { row: i + 2, date: f[2]!.slice(0, 10), amount: f[5]!, currency: f[7]!, balance: f[9] || null, state: f[8]! }),
    );
    lastRow = lines.length;
  } else if (file.bank === "raiffeisen-ua") {
    expect(bytes[0]).not.toBe(0xef);
    const lines = readCsv(new TextDecoder("windows-1251").decode(bytes), ";");
    const currency = lines[2]![1]!;
    expect(lines[file.headerRow - 1]).toEqual(["Дата операції", "Дата проведення", "Опис операції", "Дебет", "Кредит", "Залишок"]);
    lines.slice(file.headerRow).forEach((f, i) => {
      const row = file.headerRow + i + 1;
      if (!/^\d{2}\.\d{2}\.\d{4}$/.test(f[0]!)) return;
      const amount = dec(fromUa(f[4]!)).minus(dec(fromUa(f[3]!))).toFixed(2);
      rows.set(row, { row, date: fromDotted(f[0]!), amount, currency, balance: fromUa(f[5]!), state: null });
    });
    lastRow = lines.length;
  } else {
    const sheet = readSheet(bytes);
    const loan = file.sheet === "Préstamo";
    for (const [row, cells] of sheet) {
      if (row <= file.headerRow) continue;
      const c = (col: string) => cells.get(col)!;
      const dateCell = loan ? c("A") : c("B");
      expect(dateCell.style).toBe("1"); // a real date cell, not text
      const amount = loan ? c("C") : c("E");
      expect(amount.type).toBeNull(); // a number cell
      rows.set(row, {
        row,
        date: fromSerial(dateCell.value),
        amount: dec(amount.value).toFixed(2),
        currency: (loan ? c("D") : c("F")).value,
        balance: loan ? dec(c("E").value).negated().toFixed(2) : dec(c("G").value).toFixed(2),
        state: null,
      });
      lastRow = Math.max(lastRow, row);
    }
  }
  return { rows, lastRow };
}

describe("ARC-03@PoC FR 6: a family-scale synthetic dataset of bank statements", () => {
  it("ARC-03@PoC FR 6: 4 banks — monobank, Revolut, BBVA, Raiffeisen UA — each account with a statement per year", () => {
    expect(new Set(two.truth.accounts.map((a) => a.bank))).toEqual(new Set(["monobank", "revolut", "bbva", "raiffeisen-ua"]));
    for (const a of two.truth.accounts)
      expect(two.truth.files.filter((f) => f.account === a.id).map((f) => f.from)).toEqual(["2024-01-01", "2025-01-01"]);
    expect(new Set(two.truth.files.map((f) => f.format))).toEqual(new Set(["csv", "xlsx"]));
    expect(three.truth.files.filter((f) => f.account === "bbva-eur").map((f) => [f.from, f.to])).toEqual([
      ["2024-07-01", "2024-12-31"],
      ["2025-01-01", "2025-12-31"],
      ["2026-01-01", "2026-12-31"],
      ["2027-01-01", "2027-06-30"],
    ]);
    // A file stays far below the importer's 20 000-row ceiling (IMP-01).
    for (const f of three.truth.files) expect(f.rows.length).toBeLessThan(20_000);
  });

  it("ARC-03@PoC FR 6: 2–3 years of transactions, every account active in every month", () => {
    for (const [{ truth }, months] of [
      [two, 24],
      [three, 36],
    ] as const) {
      expect(truth.from).toBe(truth === two.truth ? "2024-01-01" : "2024-07-01");
      expect(truth.to).toBe(truth === two.truth ? "2025-12-31" : "2027-06-30");
      for (const a of truth.accounts) {
        const active = new Set(truth.transactions.filter((t) => t.account === a.id).map((t) => t.date.slice(0, 7)));
        expect(active.size, a.id).toBe(months);
      }
      for (const t of truth.transactions) {
        expect(t.date >= truth.from && t.postedDate <= truth.to && t.postedDate >= t.date).toBe(true);
      }
    }
    expect(() => generateFamily({ seed: "s", start: "2024-01-15", years: 2 })).toThrow(/1st of a month/);
    expect(() => generateFamily({ seed: "s", start: "2024-01-01", years: 4 as 3 })).toThrow(/2 or 3/);
  });

  it("ARC-03@PoC FR 6: a credit card within its limit, repaid monthly, and a loan that accrues interest and shrinks", () => {
    const { truth } = three;
    const card = truth.accounts.find((a) => a.kind === "credit_card")!;
    const cardTx = truth.transactions.filter((t) => t.account === card.id);
    for (const t of cardTx) {
      expect(dec(t.balanceAfter).lte(dec("0"))).toBe(true);
      expect(dec(t.balanceAfter).gte(dec(card.creditLimit!).negated())).toBe(true);
    }
    expect(truth.transfers.filter((t) => t.kind === "card_repayment").length).toBeGreaterThanOrEqual(30);

    const loan = truth.accounts.find((a) => a.kind === "loan")!;
    expect(dec(loan.openingBalance).isNegative()).toBe(true);
    const loanTx = truth.transactions.filter((t) => t.account === loan.id);
    expect(loanTx.filter((t) => t.type === "interest").length).toBe(36);
    expect(loanTx.filter((t) => t.transferId).length).toBe(36);
    expect(dec(loan.closingBalance).gt(dec(loan.openingBalance))).toBe(true);
    expect(dec(loan.closingBalance).isNegative()).toBe(true);
    // Interest falls as the debt shrinks.
    const interest = loanTx.filter((t) => t.type === "interest").map((t) => dec(t.amount).negated());
    expect(interest[interest.length - 1]!.lt(interest[0]!)).toBe(true);
  });

  it("ARC-03@PoC FR 6: transfers between own accounts — two legs, opposite signs, same amount or the exchange rate", () => {
    const { truth } = two;
    const tx = byId(truth);
    const kinds = new Set(truth.transfers.map((t) => t.kind));
    expect(kinds).toEqual(new Set(["own", "card_repayment", "loan_payment", "exchange"]));
    const banksCrossed = new Set(truth.transfers.map((t) => `${tx.get(t.fromTransaction)!.account}>${tx.get(t.toTransaction)!.account}`));
    expect(banksCrossed).toEqual(
      new Set(["raif-uah>mono-black", "mono-black>mono-credit", "bbva-eur>bbva-loan", "bbva-eur>revolut-eur", "revolut-eur>revolut-usd"]),
    );
    const accounts = new Set(truth.accounts.map((a) => a.id));
    for (const tr of truth.transfers) {
      const out = tx.get(tr.fromTransaction)!;
      const into = tx.get(tr.toTransaction)!;
      expect(accounts.has(out.account) && accounts.has(into.account) && out.account !== into.account).toBe(true);
      expect([out.account, into.account]).toEqual([tr.from, tr.to]);
      expect(out.transferId).toBe(tr.id);
      expect(into.transferId).toBe(tr.id);
      expect(dec(out.amount).isNegative() && dec(into.amount).isPositive()).toBe(true);
      if (out.currency === into.currency) {
        expect(tr.rate).toBeNull();
        expect(dec(into.amount).equals(dec(out.amount).negated())).toBe(true);
      } else {
        expect(dec(into.amount).equals(dec(out.amount).negated().times(dec(tr.rate!)).toDecimalPlaces(2))).toBe(true);
      }
      expect(into.date >= out.date && into.date <= `${out.date.slice(0, 8)}31`).toBe(true);
    }
    // Every transaction that names a transfer is one of its two legs.
    const legs = new Set(truth.transfers.flatMap((t) => [t.fromTransaction, t.toTransaction]));
    expect(truth.transactions.filter((t) => t.transferId).every((t) => legs.has(t.id))).toBe(true);
  });

  it("ARC-03@PoC FR 6: several currencies — UAH, EUR and USD accounts, and card payments abroad in EUR with the rate", () => {
    const { truth } = two;
    expect(new Set(truth.accounts.map((a) => a.currency))).toEqual(new Set(["UAH", "EUR", "USD"]));
    const abroad = truth.transactions.filter((t) => t.operationCurrency && t.operationCurrency !== t.currency);
    expect(abroad.length).toBeGreaterThan(10);
    for (const t of abroad) {
      expect(t.operationCurrency).toBe("EUR");
      expect(dec(t.amount).equals(dec(t.operationAmount!).times(dec(t.rate!)).toDecimalPlaces(2))).toBe(true);
    }
  });

  it("ARC-03@PoC FR 6: every statement row reads back as its ledger transaction (date, amount, sign, currency, balance)", () => {
    for (const { truth, statements } of [two, three]) {
      const tx = byId(truth);
      const seen = new Set<string>();
      for (const s of statements) {
        const read = readStatement(s);
        expect(s.file.rows.map((r) => r.row)).toEqual([...new Set(s.file.rows.map((r) => r.row))]);
        for (const r of s.file.rows) {
          if ("skip" in r) {
            if (r.skip === "reverted") expect(read.rows.get(r.row)?.state, s.file.path).toBe("REVERTED");
            else expect(read.rows.has(r.row), `${s.file.path}:${r.row}`).toBe(false);
            continue;
          }
          const t = tx.get(r.transaction)!;
          const got = read.rows.get(r.row)!;
          expect(t.account).toBe(s.file.account);
          expect({ date: got.date, amount: got.amount, currency: got.currency, balance: got.balance }, `${s.file.path}:${r.row}`).toEqual({
            date: t.date,
            amount: t.amount,
            currency: t.currency,
            balance: t.balanceAfter,
          });
          expect(seen.has(t.id)).toBe(false);
          seen.add(t.id);
        }
        // No row of the table is left unmapped.
        const mapped = new Set(s.file.rows.map((r) => r.row));
        for (const row of read.rows.keys()) expect(mapped.has(row), `${s.file.path}:${row}`).toBe(true);
        expect(read.lastRow).toBe(Math.max(s.file.headerRow, ...mapped));
        // The file balances: opening + every amount = closing.
        const sum = s.file.rows
          .filter((r): r is { row: number; transaction: string } => "transaction" in r)
          .reduce((acc, r) => acc.plus(dec(tx.get(r.transaction)!.amount)), dec(s.file.openingBalance));
        expect(sum.toFixed(2), s.file.path).toBe(s.file.closingBalance);
      }
      expect(seen.size).toBe(truth.transactions.length);
      expect(truth.files.flatMap((f) => f.rows).filter((r) => "skip" in r && r.skip === "reverted").length).toBe(truth.reverted.length);
    }
  });

  it("ARC-03@PoC FR 6: every statement lists its transactions in the order the file declares (newest or oldest first)", () => {
    for (const { truth, statements } of [two, three]) {
      const tx = byId(truth);
      for (const s of statements) {
        const moments = s.file.rows.flatMap((r) => ("transaction" in r ? [`${tx.get(r.transaction)!.date} ${tx.get(r.transaction)!.time}`] : []));
        const sorted = [...moments].sort();
        expect(moments, s.file.path).toEqual(s.file.order === "oldest-first" ? sorted : sorted.reverse());
      }
    }
  });

  it("ARC-03@PoC FR 6: file formats — monobank UTF-8 with BOM, Revolut UTF-8, Raiffeisen Windows-1251 with «;», BBVA XLSX", () => {
    const pick = (path: string) => two.statements.find((s) => s.file.path === path)!;
    const raif = pick("raiffeisen-ua/raif-uah-2024.csv");
    expect(raif.file).toMatchObject({ encoding: "windows-1251", delimiter: ";", headerRow: 5, order: "oldest-first" });
    const text = new TextDecoder("windows-1251").decode(raif.bytes);
    expect(text).toContain("Заробітна плата від ТОВ «Синтетична компанія»");
    expect(text).toMatch(/;\d{1,3}( \d{3})+,\d{2};/); // «1 234,56»
    expect(text.split("\r\n").at(-2)).toMatch(/^Вихідний залишок;/);
    expect(raif.file.rows.filter((r) => "skip" in r)).toHaveLength(2);
    // The same text is not valid UTF-8: the importer has to detect the encoding (IMP-06).
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(raif.bytes)).toThrow();

    expect(pick("monobank/mono-black-2024.csv").file).toMatchObject({ encoding: "utf-8-bom", order: "newest-first" });
    expect(pick("revolut/revolut-eur-2024.csv").file).toMatchObject({ encoding: "utf-8", order: "oldest-first" });
    const bbva = pick("bbva/bbva-eur-2024.xlsx");
    expect(bbva.file).toMatchObject({ format: "xlsx", sheet: "Movimientos", headerRow: 5 });
    expect(bbva.bytes.subarray(0, 4)).toEqual(Buffer.from("PK\x03\x04", "latin1"));
    expect([...unzip(bbva.bytes).keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    expect(excelSerial("2024-01-01")).toBe(45292);
    expect(excelSerial("1900-03-01")).toBe(61);
    expect(() => encodeCp1251("€")).toThrow(/Windows-1251/);
    expect([...encodeCp1251("ІіЇїЄєҐґ№")]).toEqual([0xb2, 0xb3, 0xaf, 0xbf, 0xaa, 0xba, 0xa5, 0xb4, 0xb9]);
  });

  it("ARC-03@PoC FR 6: deterministic — the same seed gives the same bytes, another seed other data", () => {
    const hash = (d: ReturnType<typeof generateFamily>) => {
      const h = createHash("sha256").update(JSON.stringify(d.truth));
      for (const s of d.statements) h.update(s.file.path).update(s.bytes);
      return h.digest("hex");
    };
    expect(hash(generateFamily({ seed: "willowsum", start: "2024-01-01", years: 2 }))).toBe(hash(two));
    expect(hash(generateFamily({ seed: "other", start: "2024-01-01", years: 2 }))).not.toBe(hash(two));
  });

  it("ARC-03@PoC FR 6: clearly synthetic — invalid IBAN check digits, «Synthetic» holders, zero card numbers", () => {
    const mod97 = (iban: string) => {
      const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
      let rest = 0;
      for (const d of digits) rest = (rest * 10 + Number.parseInt(d, 10)) % 97;
      return rest;
    };
    const { truth } = two;
    expect(truth.synthetic).toBe(true);
    expect(truth.household.name).toMatch(/^Synthetic/);
    for (const a of truth.accounts) {
      expect(a.holder).toMatch(/^Synthetic /);
      expect(a.name).toContain("(synthetic)");
      if (a.iban) {
        expect(a.iban.slice(2, 4)).toBe("00");
        expect(mod97(a.iban)).not.toBe(1); // ISO 13616: a real IBAN gives 1
      }
      if (a.cardMask) expect(a.cardMask).toMatch(/^0000 00\*\* \*\*\*\* \d{4}$/);
    }
  });

  it("ARC-03@PoC FR 6: amounts are decimal strings with 2 places that add up exactly (no floats)", () => {
    const { truth } = three;
    const balances = new Map(truth.accounts.map((a) => [a.id, dec(a.openingBalance)]));
    for (const t of truth.transactions) {
      expect(t.amount).toMatch(/^-?\d+\.\d{2}$/);
      const next = balances.get(t.account)!.plus(dec(t.amount));
      expect(next.toFixed(2)).toBe(t.balanceAfter);
      balances.set(t.account, next);
    }
    for (const a of truth.accounts) expect(balances.get(a.id)!.toFixed(2)).toBe(a.closingBalance);
    // Current accounts are never overdrawn.
    for (const t of truth.transactions)
      if (truth.accounts.find((a) => a.id === t.account)!.kind === "current") expect(dec(t.balanceAfter).isNegative()).toBe(false);
  });
});
