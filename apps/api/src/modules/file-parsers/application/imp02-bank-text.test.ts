import { describe, expect, it } from "vitest";
import { EVENT_LIMITS, type StatementOptions } from "../domain/index.ts";
import { parseStatement } from "./index.ts";

/**
 * IMP-02@PoC FR 4 (S-047 data): the bank's description is kept as the statement printed it — every description column
 * of the row and the free-text notes column, joined with « · », empty values and repeats left out. Synthetic rows only.
 */
const enc = (lines: readonly string[]) => new TextEncoder().encode(lines.join("\r\n"));
const parse = (lines: readonly string[], statement: StatementOptions = {}) =>
  parseStatement(enc(lines), {}, statement);
const EUR: StatementOptions = { account: { currencies: ["EUR"], multiCurrency: false } };

/** A BBVA-like export: «Concepto», «Movimiento», «Observaciones» (synthetic). */
const BBVA = [
  "F.Valor;Fecha;Concepto;Movimiento;Importe;Divisa;Disponible;Divisa;Observaciones",
  "02/03/2026;01/03/2026;Pago con tarjeta en SUPERMERCADO SINTETICO;Pago con tarjeta;-25,40;EUR;974,60;EUR;Tarjeta 4111 1111 1111 1234",
  "05/03/2026;04/03/2026;Transferencia recibida;Transferencia;500,00;EUR;1.474,60;EUR;",
  "15/03/2026;14/03/2026;Bizum enviado;Bizum enviado;-10,00;EUR;1.464,60;EUR;Cena amigos",
];

describe("IMP-02@PoC FR 4: the bank's description as printed, from every description column", () => {
  it("IMP-02@PoC FR 4: the BBVA-like headers take their roles — «Concepto», «Movimiento» and «Observaciones» are all description", () => {
    const { analysis } = parse(BBVA, EUR);
    const role = (header: string) =>
      analysis.columns.find((c) => c.header === header)?.role.chosen.value ?? null;
    expect(role("Fecha")).toBe("date");
    expect(role("F.Valor")).toBe("value-date");
    expect(role("Importe")).toBe("amount");
    expect(role("Concepto")).toBe("description");
    expect(role("Movimiento")).toBe("description");
    expect(role("Observaciones")).toBe("description");
    expect(analysis.columns.find((c) => c.column === 7)?.role.chosen.value).toBe("balance");
  });

  it("IMP-02@PoC FR 4: the description columns and the notes column are joined with « · », an empty value and a repeat left out", () => {
    const { events } = parse(BBVA, EUR).events;
    expect(events.map((e) => e.description)).toEqual([
      "Pago con tarjeta en SUPERMERCADO SINTETICO · Pago con tarjeta · Tarjeta 4111 1111 1111 1234",
      "Transferencia recibida · Transferencia",
      "Bizum enviado · Cena amigos",
    ]);
    // #696 (IMP-04 FR 1): the first description column alone, as the description was before — the key of an earlier import.
    expect(events.map((e) => e.legacyDescription)).toEqual([
      "Pago con tarjeta en SUPERMERCADO SINTETICO",
      "Transferencia recibida",
      "Bizum enviado",
    ]);
    expect(events.map((e) => e.legs[0]!.amount)).toEqual(["-25.40", "500.00", "-10.00"]);
    expect(events[0]).toMatchObject({ date: "2026-03-01", valueDate: "2026-03-02", balance: "974.60" });
    expect(events.every((e) => !e.flags.includes("text-cut"))).toBe(true);
  });

  it("IMP-02@PoC FR 4: one description column keeps its cell untouched, as printed", () => {
    const { events } = parse(["Дата;Сума;Опис", "01.03.2026;-5,00;  Хліб  "], EUR).events;
    expect(events[0]!.description).toBe("  Хліб  ");
  });

  it("IMP-02@PoC FR 4: the joined text keeps the length bound — cut at it and flagged «text-cut»", () => {
    const long = "Д".repeat(EVENT_LIMITS.textChars - 5);
    const { events } = parse(
      ["Дата;Сума;Опис;Примітка", `01.03.2026;-5,00;${long};Синтетична примітка`],
      EUR,
    ).events;
    expect([...events[0]!.description!].length).toBe(EVENT_LIMITS.textChars);
    expect(events[0]!.description!.startsWith(`${long} · Си`)).toBe(true);
    expect(events[0]!.flags).toContain("text-cut");
  });

  it("IMP-02@PoC FR 4: a monobank-like file keeps its one «Деталі операції» text, the original amount and the rate", () => {
    const { events } = parse(
      [
        "Дата i час операції;Деталі операції;MCC;Сума в валюті картки (UAH);Сума в валюті операції;Валюта;Курс;Сума комісій (UAH);Сума кешбеку (UAH);Залишок після операції",
        "01.03.2026 10:15:00;Сільпо;5411;-412,50;-412,50;UAH;;;;9 587,50",
        "03.03.2026 18:02:11;GOOGLE *Синтетика;5818;-450,00;-10,00;EUR;45,0000;;;9 137,50",
      ],
      { account: { currencies: ["UAH"], multiCurrency: false } },
    ).events;
    expect(events.map((e) => e.description)).toEqual(["Сільпо", "GOOGLE *Синтетика"]);
    expect(events[1]).toMatchObject({
      legs: [{ amount: "-450.00", currency: "UAH" }],
      original: { amount: "-10.00", currency: "EUR" },
      rate: "45.0000",
    });
  });
});
