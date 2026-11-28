import { describe, expect, it } from "vitest";
import { normalizeDescription } from "../../merchants/index.ts";
import {
  DERIVATION_FOREGROUND_MAX,
  descriptionWords,
  deriveSuggestions,
  type DerivationRow,
  type DerivedSuggestion,
} from "./history-derivation.ts";

/**
 * BUD-21@PoC «Правила з історії розбору» c) (wave 2 row 235): the derivation engine over the array of rows. Every row is
 * synthetic; categories and accounts are opaque ids.
 */
const CAT = {
  groceries: "00000000-0000-4000-8000-000000000001",
  home: "00000000-0000-4000-8000-000000000002",
  clothes: "00000000-0000-4000-8000-000000000003",
  gifts: "00000000-0000-4000-8000-000000000004",
  fuel: "00000000-0000-4000-8000-000000000005",
  cafes: "00000000-0000-4000-8000-000000000006",
  delivery: "00000000-0000-4000-8000-000000000007",
  utilities: "00000000-0000-4000-8000-000000000008",
  subscriptions: "00000000-0000-4000-8000-000000000009",
} as const;
const MONO = "10000000-0000-4000-8000-000000000001";

let next = 1;
function row(over: Partial<DerivationRow> & Pick<DerivationRow, "categoryId">): DerivationRow {
  const n = next++;
  return {
    row: n,
    date: day(n),
    amount: "-100.00",
    currency: "UAH",
    merchant: null,
    description: null,
    accountId: null,
    tags: [],
    ...over,
  };
}
const day = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
const times = (n: number, make: (i: number) => DerivationRow) => Array.from({ length: n }, (_, i) => make(i));
/** The groups' rows by turns, one day each — no group ends the array (no change of habit, FR 15). */
function mixed(...groups: DerivationRow[][]): DerivationRow[] {
  const out: DerivationRow[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++)
    for (const g of groups) if (i < g.length) out.push(g[i]!);
  return out.map((r, i) => ({ ...r, date: day(1000 + i) }));
}

const forMerchant = (out: readonly DerivedSuggestion[], merchant: string) =>
  out.filter((s) => s.conditions[0]?.field === "merchant" && s.conditions[0].value === merchant);

describe("BUD-21@PoC FR 12, FR 13: «Мерчант дорівнює» and its score", () => {
  it("BUD-21@PoC AC11: 14 «Продукти» and 1 «Дім» of «Сільпо» give a confident suggestion with 15 rows, 14 agreeing, and «Дім» as an exception in the file", () => {
    const rows = [
      ...times(7, () => row({ merchant: "Сільпо", categoryId: CAT.groceries })),
      row({ merchant: "Сільпо", categoryId: CAT.home }),
      ...times(7, () => row({ merchant: "Сільпо", categoryId: CAT.groceries })),
    ];
    const [s, ...rest] = deriveSuggestions(rows);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({
      kind: "confident",
      conditions: [{ field: "merchant", operator: "equals", value: "Сільпо" }],
      categoryId: CAT.groceries,
      matched: 15,
      agreeing: 14,
      since: null,
      exceptions: [rows[7]!.row],
    });
    expect(s!.rows).toHaveLength(14);
  });

  it("BUD-21@PoC FR 14: the exceptions do not cancel a suggestion while the share stays within the thresholds", () => {
    // 9 of 10 agree (90 %): still confident; the one other row is an exception, nothing has to be corrected.
    const rows = [
      ...times(9, () => row({ merchant: "АТБ", categoryId: CAT.groceries })),
      row({ merchant: "АТБ", categoryId: CAT.gifts, date: "2025-01-05" }),
    ];
    const [s] = deriveSuggestions(rows);
    expect(s).toMatchObject({ kind: "confident", matched: 10, agreeing: 9, exceptions: [rows[9]!.row] });
  });

  it("BUD-21@PoC AC12: «SILPO 1234 KYIV», «SILPO 0456 LVIV» and the like are one merchant by the cleaning of descriptions, one suggestion", () => {
    const texts = [
      "SILPO 1234 KYIV",
      "SILPO 0456 LVIV",
      "SILPO 0789 ODESA",
      "SILPO 1111 KYIV",
      "SILPO 2222",
      "SILPO 3333 DNIPRO",
    ];
    const rows = texts.map((t) =>
      row({ merchant: normalizeDescription(t)!.name, description: t, categoryId: CAT.groceries }),
    );
    expect(new Set(rows.map((r) => r.merchant)).size).toBe(1);
    const out = deriveSuggestions(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "confident", matched: 6, conditions: [{ field: "merchant" }] });
  });

  it("BUD-21@PoC FR 13: N of 3–4 all of one category is confident; 2 rows give nothing; 3 rows of two categories nothing", () => {
    expect(
      deriveSuggestions(times(3, () => row({ merchant: "Аптека", categoryId: CAT.home })))[0],
    ).toMatchObject({
      kind: "confident",
      matched: 3,
    });
    expect(deriveSuggestions(times(2, () => row({ merchant: "Аптека", categoryId: CAT.home })))).toEqual([]);
    expect(
      deriveSuggestions([
        ...times(3, () => row({ merchant: "Аптека", categoryId: CAT.home })),
        row({ merchant: "Аптека", categoryId: CAT.gifts }),
      ]),
    ).toEqual([]);
  });

  it("BUD-21@PoC FR 13: a share of 60 % to under 90 % with N ≥ 5 and no refinement is «суперечлива»", () => {
    const rows = mixed(
      times(7, () => row({ merchant: "Епіцентр", categoryId: CAT.home })),
      times(3, () => row({ merchant: "Епіцентр", categoryId: CAT.gifts })),
    );
    const out = deriveSuggestions(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "conflicting", categoryId: CAT.home, matched: 10, agreeing: 7 });
  });

  it("BUD-21@PoC AC14: 9 «Дім», 6 «Одяг», 5 «Подарунки» of «Amazon» and no refining condition with a share of 60 % — no suggestion", () => {
    const rows = mixed(
      times(9, () => row({ merchant: "Amazon", description: "AMAZON EU", categoryId: CAT.home })),
      times(6, () => row({ merchant: "Amazon", description: "AMAZON EU", categoryId: CAT.clothes })),
      times(5, () => row({ merchant: "Amazon", description: "AMAZON EU", categoryId: CAT.gifts })),
    );
    expect(forMerchant(deriveSuggestions(rows), "Amazon")).toEqual([]);
  });
});

describe("BUD-21@PoC FR 12: the refining condition of a merchant with mixed categories", () => {
  it("BUD-21@PoC AC15: 16 «Shell» above 40 EUR «Пальне» and 8 up to 15 EUR «Кафе» give two confident suggestions with an amount threshold and none by the merchant alone", () => {
    const rows = mixed(
      times(16, (i) =>
        row({
          merchant: "Shell",
          description: "SHELL",
          amount: `-${41 + i}.50`,
          currency: "EUR",
          categoryId: CAT.fuel,
        }),
      ),
      times(8, (i) =>
        row({
          merchant: "Shell",
          description: "SHELL",
          amount: `-${8 + i}.00`,
          currency: "EUR",
          categoryId: CAT.cafes,
        }),
      ),
    );
    const out = forMerchant(deriveSuggestions(rows), "Shell");
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.kind === "confident" && s.conditions.length === 2)).toBe(true);
    const fuel = out.find((s) => s.categoryId === CAT.fuel)!;
    const cafes = out.find((s) => s.categoryId === CAT.cafes)!;
    expect(fuel).toMatchObject({
      matched: 16,
      conditions: [{}, { field: "amount", operator: "greater", value: { amount: "15", currency: "EUR" } }],
    });
    expect(cafes).toMatchObject({
      matched: 8,
      conditions: [{}, { field: "amount", operator: "less", value: { amount: "41.5", currency: "EUR" } }],
    });
  });

  it("BUD-21@PoC AC13: «Рахунок дорівнює» only for the value matched with an account of the space, none for «Готівка»", () => {
    const rows = mixed(
      times(6, () =>
        row({ merchant: "Ринок", description: "РИНОК", accountId: MONO, categoryId: CAT.groceries }),
      ),
      times(6, () => row({ merchant: "Ринок", description: "РИНОК", accountId: null, categoryId: CAT.home })),
    );
    const out = forMerchant(deriveSuggestions(rows), "Ринок");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "confident",
      categoryId: CAT.groceries,
      matched: 6,
      conditions: [{ field: "merchant" }, { field: "account", operator: "equals", value: MONO }],
    });
    expect(out.flatMap((s) => s.conditions).filter((c) => c.field === "account")).toHaveLength(1);
  });

  it("BUD-21@PoC FR 12: «Опис містить <слово>» refines when the words split the merchant's rows; on a tie the earlier condition (amount) wins", () => {
    const byWord = mixed(
      times(5, () => row({ merchant: "Rozetka", description: "ROZETKA KNYHY", categoryId: CAT.gifts })),
      times(5, () => row({ merchant: "Rozetka", description: "ROZETKA TEKHNIKA", categoryId: CAT.home })),
    );
    const words = forMerchant(deriveSuggestions(byWord), "Rozetka");
    expect(words.map((s) => s.conditions[1])).toEqual([
      { field: "description", operator: "contains", value: "knyhy" },
    ]);
    // Words and amounts split equally well: the amount comes first in FR 12's list.
    const tie = mixed(
      times(5, () =>
        row({ merchant: "Rozetka", description: "ROZETKA KNYHY", amount: "-10.00", categoryId: CAT.gifts }),
      ),
      times(5, () =>
        row({
          merchant: "Rozetka",
          description: "ROZETKA TEKHNIKA",
          amount: "-900.00",
          categoryId: CAT.home,
        }),
      ),
    );
    const both = forMerchant(deriveSuggestions(tie), "Rozetka");
    expect(both).toHaveLength(2);
    expect(both.every((s) => s.conditions[1]!.field === "amount")).toBe(true);
  });

  it("BUD-21@PoC FR 11: an amount threshold is in the row's currency; rows in another currency or without one match none", () => {
    const rows = mixed(
      times(6, () =>
        row({
          merchant: "Booking",
          description: "BOOKING",
          amount: "-300.00",
          currency: "EUR",
          categoryId: CAT.gifts,
        }),
      ),
      times(6, () =>
        row({
          merchant: "Booking",
          description: "BOOKING",
          amount: "-20.00",
          currency: "EUR",
          categoryId: CAT.home,
        }),
      ),
      times(2, () =>
        row({
          merchant: "Booking",
          description: "BOOKING",
          amount: "-20.00",
          currency: null,
          categoryId: CAT.gifts,
        }),
      ),
    );
    const out = forMerchant(deriveSuggestions(rows), "Booking");
    expect(out.map((s) => s.matched).sort()).toEqual([6, 6]);
    expect(
      out.every(
        (s) =>
          s.conditions[1]!.field === "amount" &&
          (s.conditions[1]!.value as { currency: string }).currency === "EUR",
      ),
    ).toBe(true);
  });
});

describe("BUD-21@PoC FR 15: a change of habit", () => {
  it("BUD-21@PoC AC16: 22 «Кафе» before 1 June and 8 «Доставка їжі» from 1 June give a confident «Glovo → Доставка їжі» since 1 June, the 22 older rows no exceptions", () => {
    const rows = [
      ...times(22, (i) =>
        row({ merchant: "Glovo", date: `2025-05-${String(i + 1).padStart(2, "0")}`, categoryId: CAT.cafes }),
      ),
      ...times(8, (i) =>
        row({
          merchant: "Glovo",
          date: `2025-06-${String(i + 1).padStart(2, "0")}`,
          categoryId: CAT.delivery,
        }),
      ),
    ];
    const out = deriveSuggestions(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "confident",
      categoryId: CAT.delivery,
      since: "2025-06-01",
      matched: 8,
      agreeing: 8,
      exceptions: [],
    });
  });

  it("BUD-21@PoC FR 15: two latest rows of a new category are no change of habit; a third of another category after the first breaks it", () => {
    const two = [
      ...times(10, () => row({ merchant: "Uklon", categoryId: CAT.cafes })),
      ...times(2, () => row({ merchant: "Uklon", categoryId: CAT.delivery })),
    ];
    expect(deriveSuggestions(two)[0]).toMatchObject({ since: null, categoryId: CAT.cafes });
    const broken = [
      ...times(10, () => row({ merchant: "Bolt", categoryId: CAT.cafes })),
      ...times(2, () => row({ merchant: "Bolt", categoryId: CAT.delivery })),
      row({ merchant: "Bolt", categoryId: CAT.cafes }),
      ...times(2, () => row({ merchant: "Bolt", categoryId: CAT.delivery })),
    ];
    expect(deriveSuggestions(broken).every((s) => s.since === null)).toBe(true);
  });
});

describe("BUD-21@PoC FR 12: «Опис містить <слово або фраза>»", () => {
  it("BUD-21@PoC AC17: 12 rows without a merchant whose descriptions contain «ОСББ», all «Комунальні», give a confident «Опис містить ОСББ»", () => {
    const rows = times(12, (i) =>
      row({ merchant: null, description: `Внесок ОСББ за ${i + 1} місяць`, categoryId: CAT.utilities }),
    );
    const out = deriveSuggestions(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "confident", categoryId: CAT.utilities, matched: 12 });
    expect(out[0]!.conditions).toHaveLength(1);
    const [c] = out[0]!.conditions;
    expect(c!.field).toBe("description");
    expect(String(c!.value).toLowerCase()).toContain("осбб");
  });

  it("BUD-21@PoC FR 12: a word grows into the phrase every row shares, in the file's case", () => {
    const rows = times(5, (i) =>
      row({ merchant: null, description: `Оплата Київводоканал рахунок ${i}`, categoryId: CAT.utilities }),
    );
    expect(deriveSuggestions(rows)[0]!.conditions[0]).toEqual({
      field: "description",
      operator: "contains",
      value: "Оплата Київводоканал рахунок",
    });
  });

  it("BUD-21@PoC FR 12: words shorter than 3 characters, numbers and dates are not taken; a word of one merchant only is no candidate", () => {
    expect(descriptionWords("на 12.03.2025 оплата 2025 ab осбб7 осбб")).toEqual(["оплата", "осбб"]);
    // «Prostir» rows: one merchant, 2 rows, too few for the merchant; its word is not shared with another source.
    const rows = times(4, () =>
      row({ merchant: "Prostir", description: "PROSTIR MAGAZYN", categoryId: CAT.gifts }),
    );
    rows.push(row({ merchant: "Prostir", description: "PROSTIR MAGAZYN", categoryId: CAT.home }));
    expect(deriveSuggestions(rows).filter((s) => s.conditions[0]!.field === "description")).toEqual([]);
  });

  it("BUD-21@PoC EC7: of two candidates that explain the same rows (the merchant and a word of its description) the earlier one stays", () => {
    const rows = [
      ...times(6, () =>
        row({ merchant: "Novus", description: "NOVUS SUPERMARKET", categoryId: CAT.groceries }),
      ),
      ...times(6, () =>
        row({ merchant: "Fora", description: "FORA SUPERMARKET", categoryId: CAT.groceries }),
      ),
    ];
    const out = deriveSuggestions(rows);
    expect(out.map((s) => s.conditions[0]!.field)).toEqual(["merchant", "merchant"]);
  });

  it("BUD-21@PoC FR 12: a word shared by rows of two merchants left unexplained gives a suggestion", () => {
    const rows = [
      ...times(2, () => row({ merchant: "Kino A", description: "KINO A CINEMA", categoryId: CAT.gifts })),
      ...times(2, () => row({ merchant: "Kino B", description: "KINO B CINEMA", categoryId: CAT.gifts })),
    ];
    const out = deriveSuggestions(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.conditions[0]).toMatchObject({ field: "description" });
    expect(out[0]!.matched).toBe(4);
  });
});

describe("BUD-21@PoC FR 17: tags", () => {
  it("BUD-21@PoC AC19: 10 «Netflix» rows of «Підписки», 9 with the tag «родина», give the actions «категорія Підписки» and «тег родина»", () => {
    const rows = [
      ...times(9, (i) =>
        row({ merchant: "Netflix", categoryId: CAT.subscriptions, tags: i === 0 ? ["Родина"] : ["родина "] }),
      ),
      row({ merchant: "Netflix", categoryId: CAT.subscriptions, tags: [] }),
    ];
    expect(deriveSuggestions(rows)[0]).toMatchObject({ categoryId: CAT.subscriptions, tags: ["Родина"] });
    // 8 of 10 is under 90 %: no tag.
    const fewer = [
      ...times(8, () => row({ merchant: "Megogo", categoryId: CAT.subscriptions, tags: ["родина"] })),
      ...times(2, () => row({ merchant: "Megogo", categoryId: CAT.subscriptions })),
    ];
    expect(deriveSuggestions(fewer)[0]!.tags).toEqual([]);
  });
});

describe("BUD-21@PoC FR 11: a deterministic engine", () => {
  const sample = (): DerivationRow[] => {
    next = 1;
    return [
      ...times(15, (i) => row({ merchant: "Сільпо", categoryId: i === 3 ? CAT.home : CAT.groceries })),
      ...times(12, (i) => row({ merchant: null, description: `ОСББ ${i}`, categoryId: CAT.utilities })),
      ...mixed(
        times(16, (i) =>
          row({ merchant: "Shell", amount: `-${50 + i}.00`, currency: "EUR", categoryId: CAT.fuel }),
        ),
        times(8, () => row({ merchant: "Shell", amount: "-9.00", currency: "EUR", categoryId: CAT.cafes })),
      ),
      ...times(10, () => row({ merchant: "Netflix", categoryId: CAT.subscriptions, tags: ["родина"] })),
    ];
  };

  it("BUD-21@PoC AC29: the same rows give the same suggestions, numbers and order — also when the rows come in another order", () => {
    const first = deriveSuggestions(sample());
    const again = deriveSuggestions(sample());
    const shuffled = deriveSuggestions([...sample()].reverse());
    expect(again).toEqual(first);
    expect(shuffled).toEqual(first);
    expect(first.length).toBeGreaterThanOrEqual(4);
  });

  it("BUD-21@PoC FR 11: the order of the suggestions — confident first, more conditions, larger N, then the merchant or the word", () => {
    const out = deriveSuggestions(sample());
    expect(out.map((s) => [s.kind, s.conditions.length, s.matched])).toEqual(
      [...out.map((s) => [s.kind, s.conditions.length, s.matched])].sort(
        (a, b) =>
          (a[0] === b[0] ? 0 : a[0] === "confident" ? -1 : 1) ||
          (b[1] as number) - (a[1] as number) ||
          (b[2] as number) - (a[2] as number),
      ),
    );
    expect(out[0]!.conditions).toHaveLength(2);
  });
});

describe("BUD-21@PoC FR 10: 20 000 rows", () => {
  it("BUD-21@PoC AC31: the engine derives over 20 000 rows well within 60 seconds", () => {
    next = 1;
    const merchants = Array.from(
      { length: 400 },
      (_, i) => `Мерчант ${String.fromCharCode(0x430 + (i % 32))}${i}`,
    );
    const cats = Object.values(CAT);
    const rows = times(20_000, (i) =>
      row({
        merchant: i % 10 === 0 ? null : merchants[i % merchants.length]!,
        description: `Оплата товарів ${merchants[(i * 7) % merchants.length]} магазин ${i % 97}`,
        amount: `-${(i % 500) + 1}.${String(i % 100).padStart(2, "0")}`,
        categoryId: cats[(i % merchants.length) % cats.length]!,
        date: day(i % 700),
      }),
    );
    const started = performance.now();
    const out = deriveSuggestions(rows);
    const ms = performance.now() - started;
    expect(ms).toBeLessThan(60_000);
    expect(out.length).toBeGreaterThan(0);
    expect(DERIVATION_FOREGROUND_MAX).toBe(2000);
  }, 60_000);
});
