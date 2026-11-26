import { describe, expect, it } from "vitest";
import { detectedMask, hasCardMask, type Institution, type StatementOptions } from "../domain/index.ts";
import { parseStatement } from "./parse-statement.ts";

/**
 * IMP-08@PoC FR 2, server part (plan row 230): what the statement says about its own account — the bank (an exact or
 * normalised match against the directory of banks), the one currency, the card or IBAN masked to its last 4
 * characters — for «Створити рахунок». Synthetic statements only; numbers are built at runtime (no bank has them).
 */
const enc = (s: string) => new TextEncoder().encode(s);
const parse = (lines: readonly string[], statement: StatementOptions = {}) =>
  parseStatement(enc(lines.join("\n")), { delimiter: ";" }, statement);

/** A part of the directory as accounts ships it (names and legal names of the NBU list). */
const BANKS: readonly Institution[] = [
  { name: "Універсал Банк (monobank)", legalName: 'АТ "УНІВЕРСАЛ БАНК"' },
  { name: "ПриватБанк", legalName: 'АТ КБ "ПРИВАТБАНК"' },
  { name: "ПУМБ", legalName: 'АТ "ПУМБ"' },
  { name: "Райффайзен Банк", legalName: 'АТ "Райффайзен Банк"' },
];
const CARD = ["5375", "41", "**", "****", "1234"].join("");
const IBAN = ["LT", "12", "3250", "0000", "0000", "5678"].join("");
const FULL_IBAN_DIGITS = IBAN.slice(2);

const ROWS = ["Дата;Сума;Опис", "01.03.2026;-12,50;Кава", "02.03.2026;-40,00;Продукти"];

/** A monobank-like card statement: the bank's name and a masked card before the table, hryvnias. */
const MONOBANK = [
  "Виписка АТ «Універсал Банк» (monobank)",
  `Картка;${CARD.slice(0, 4)} ${CARD.slice(4, 8)} ${CARD.slice(8, 12)} ${CARD.slice(12)}`,
  "Валюта;UAH",
  "Дата;Сума;Валюта;Опис",
  "01.03.2026;-12,50;UAH;Кава",
  "02.03.2026;-40,00;UAH;Продукти",
];

/** A Revolut-like EUR statement: a bank that is not in the NBU directory, a masked card and an IBAN. */
const REVOLUT = [
  "Revolut Bank UAB",
  "EUR Statement",
  "Card;**** 5678",
  `IBAN;${IBAN.replace(/(.{4})/g, "$1 ").trim()}`,
  "Date;Amount;Currency;Description",
  "01.03.2026;-12,50;EUR;Coffee",
  "02.03.2026;-40,00;EUR;Groceries",
];

describe("IMP-08@PoC FR 2 (server part): the statement's own account facts for «Створити рахунок»", () => {
  it("IMP-08@PoC FR 2: a monobank-like statement — bank from the directory, UAH, the card as …1234", () => {
    const p = parse(MONOBANK, { institutions: BANKS });
    expect(p.events.events).toHaveLength(2);
    expect(p.checks.detected).toEqual({
      bank: "Універсал Банк (monobank)",
      bankInDirectory: true,
      currency: "UAH",
      mask: "…1234",
    });
  });

  it("IMP-08@PoC FR 2: a Revolut-like EUR statement — the bank outside the directory as printed, EUR, the card …5678 before the IBAN", () => {
    const p = parse(REVOLUT, { institutions: BANKS });
    expect(p.checks.detected).toEqual({
      bank: "Revolut Bank UAB",
      bankInDirectory: false,
      currency: "EUR",
      mask: "…5678",
    });
  });

  it("IMP-08@PoC FR 2: a preamble that names no bank, card or IBAN — no bank and no mask (the person picks them)", () => {
    const p = parse(["Виписка за березень", ...ROWS], { institutions: BANKS });
    expect(p.checks.detected?.bank).toBeUndefined();
    expect(p.checks.detected?.mask).toBeUndefined();
  });

  it("IMP-08@PoC FR 2: an IBAN alone is masked to its last 4 characters; the full number is nowhere in the result", () => {
    const p = parse([
      "Рахунок",
      `IBAN ${IBAN}`,
      "Валюта;EUR",
      "Дата;Сума;Валюта;Опис",
      "01.03.2026;-1,00;EUR;Кава",
      "02.03.2026;-2,00;EUR;Чай",
    ]);
    expect(p.checks.detected?.mask).toBe("…5678");
    const all = JSON.stringify(p.checks);
    expect(all).not.toContain(IBAN);
    expect(all).not.toContain(FULL_IBAN_DIGITS);
    expect(all).not.toContain("5375");
  });

  it("IMP-08@PoC FR 2: two different cards or two currencies are ambiguous — no mask, no currency", () => {
    const p = parse([
      "Картка;**** 1111",
      "Картка;**** 2222",
      "Дата;Сума;Валюта;Опис",
      "01.03.2026;-1,00;EUR;Кава",
      "02.03.2026;-2,00;USD;Чай",
    ]);
    expect(p.checks.detected).toEqual({});
  });

  it("IMP-08@PoC FR 2: a bank, a card or an IBAN printed only in the transaction rows is not the statement's own", () => {
    const p = parse(
      [
        "Виписка за березень",
        "Дата;Сума;Опис",
        "01.03.2026;-12,50;Переказ ПриватБанк **** 9999",
        `02.03.2026;-40,00;${IBAN} monobank`,
      ],
      { institutions: BANKS },
    );
    expect(p.checks.detected?.bank).toBeUndefined();
    expect(p.checks.detected?.mask).toBeUndefined();
  });

  it("IMP-08@PoC FR 2: without a directory no bank is detected; the directory is never matched by a part of a word", () => {
    expect(parse(MONOBANK).checks.detected?.bank).toBeUndefined();
    // «ПУМБ» inside another word is not the bank.
    const p = parse(["ТОВ ПУМБАЛЕТ", ...ROWS], { institutions: BANKS });
    expect(p.checks.detected?.bank).toBeUndefined();
  });

  it("IMP-08@PoC FR 2: a Latin «x» inside a word («Box 2024», «Fax 044 …», «Index 01001») is not a masked card — the IBAN is the mask", () => {
    for (const cell of ["Box 2024", "Fax 044 123 4567", "Index 01001"]) {
      const p = parse([
        `IBAN;${IBAN}`,
        `Адреса;${cell}`,
        "Дата;Сума;Валюта;Опис",
        "01.03.2026;-1,00;EUR;Кава",
        "02.03.2026;-2,00;EUR;Чай",
      ]);
      expect(p.checks.detected?.mask, cell).toBe("…5678");
    }
    // Marks written as x stay marks.
    expect(detectedMask([["Card", "xxxx xxxx xxxx 4321"]])).toBe("…4321");
    expect(detectedMask([["Картка", "XXXX 4321"]])).toBe("…4321");
    expect(detectedMask([["Box 2024"]])).toBeNull();
  });

  it("IMP-05@PoC: a masked card in the rows before the table is still a card when its marks are x, and «Box 2024» is not (#711)", () => {
    for (const cell of [
      "4149 49xx xxxx 1234",
      "Картка 4149**1234",
      "Номер414949XXXXXX1234",
      "Карткаxxxx1234",
      "Card XXXX 1234",
    ])
      expect(hasCardMask([["Картка", cell]]), cell).toBe(true);
    for (const cell of ["Box 2024", "Fax 044 123 4567", "Index 01001"])
      expect(hasCardMask([["Адреса", cell]]), cell).toBe(false);
  });
});
