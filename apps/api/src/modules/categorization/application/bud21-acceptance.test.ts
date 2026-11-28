import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  acceptanceOrder,
  againstRules,
  descriptionsDiffer,
  historyCheck,
  suggestionKey,
  type DerivationRow,
  type SuggestionCondition,
} from "../domain/index.ts";
import { acceptedRules, existingMatches, resolveCategory, shownSuggestions } from "./acceptance.ts";
import type { StoredSuggestion } from "./derivations.ts";
import type { RuleDeps, RuleInputRow, StoredRule } from "./rules.ts";
import type { CategoryFactsPort } from "./transaction-categories.ts";

/**
 * BUD-21@PoC «Правила з історії розбору» e) (wave 2 row 237): the check on the history, the suggestions against the
 * existing transactions and rules, the order of accepted rules and a category deleted or merged before the acceptance.
 * Every row and name is synthetic; categories and rules are opaque ids.
 */
const HOUSEHOLD = "20000000-0000-4000-8000-000000000001";
const CAT = {
  groceries: "00000000-0000-4000-8000-000000000001",
  cafes: "00000000-0000-4000-8000-000000000002",
  delivery: "00000000-0000-4000-8000-000000000003",
  subscriptions: "00000000-0000-4000-8000-000000000004",
  fun: "00000000-0000-4000-8000-000000000005",
  fuel: "00000000-0000-4000-8000-000000000006",
  home: "00000000-0000-4000-8000-000000000007",
  utilities: "00000000-0000-4000-8000-000000000008",
} as const;

const day = (i: number) => new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);

let nextRow = 1;
function row(i: number, merchant: string, categoryId: string): DerivationRow {
  return {
    row: nextRow++,
    date: day(i),
    amount: "-100.00",
    currency: "UAH",
    merchant,
    description: merchant.toUpperCase(),
    accountId: null,
    categoryId,
    tags: [],
  };
}

const merchant = (value: string): SuggestionCondition => ({ field: "merchant", operator: "equals", value });

function stored(
  over: Partial<StoredSuggestion> & Pick<StoredSuggestion, "ordinal" | "conditions" | "categoryId">,
) {
  return {
    kind: "confident" as const,
    matched: 10,
    agreeing: 10,
    since: null,
    tags: [],
    rows: [1, 2, 3],
    exceptions: [],
    ...over,
  } satisfies StoredSuggestion;
}

function rule(
  over: Partial<StoredRule> & Pick<StoredRule, "id" | "position" | "conditions" | "categoryId">,
): StoredRule {
  return { accountIds: [], enabled: true, tags: [], version: 1, ...over };
}

const allActive: CategoryFactsPort = { category: async () => ({ kind: "expense", state: "active" }) };

describe("BUD-21@PoC FR 18: the check on the history", () => {
  it("BUD-21@PoC AC20: of 1 000 rows the coverage and the agreement are counted on the latest 200 by date with rules derived from the first 800; 40 rows are too few", () => {
    const early: DerivationRow[] = [];
    // The first 800 days: «Сільпо», «АТБ», «Shell», «Glovo» by turns, each always of one category.
    const habits: [string, string][] = [
      ["Сільпо", CAT.groceries],
      ["АТБ", CAT.groceries],
      ["Shell", CAT.fuel],
      ["Glovo", CAT.cafes],
    ];
    for (let i = 0; i < 800; i++) early.push(row(i, habits[i % 4]![0], habits[i % 4]![1]));
    // The latest 200: the same three as before, «Glovo» now «Доставка їжі» and a merchant the first 800 never had.
    const late: DerivationRow[] = [];
    for (let i = 0; i < 200; i++) {
      const at = 800 + i;
      const turn = i % 5;
      if (turn < 3) late.push(row(at, habits[turn]![0], habits[turn]![1]));
      else if (turn === 3) late.push(row(at, "Glovo", CAT.delivery));
      else late.push(row(at, "Rozetka", CAT.home));
    }
    // Given out of date order: the check sorts by date itself.
    const check = historyCheck([...late, ...early].reverse());
    expect(check).toEqual({ status: "ready", rows: 200, covered: 160, agreeing: 120 });

    const short = historyCheck(early.slice(0, 40));
    expect(short).toEqual({ status: "too_short", rows: 40 });
    expect(historyCheck(early.slice(0, 50)).status).toBe("ready");
  });
});

/** Module transactions' rule inputs and module merchants' names, as the rules read them. */
function inputsOf(rows: readonly RuleInputRow[]): Pick<RuleDeps, "merchants" | "inputs"> {
  return {
    inputs: {
      inputs: async () => new Map(),
      candidates: async (_h, limit) => ({ items: rows.slice(0, limit), more: rows.length > limit }),
    },
    merchants: {
      names: async () => new Map(),
      knownNames: async (_h, texts) =>
        new Map(texts.map((t) => [t, t.startsWith("SILPO") ? "Сільпо" : t] as [string, string])),
    },
  };
}

let nextTransaction = 1;
function transaction(counterparty: string, imported = true): RuleInputRow {
  const n = nextTransaction++;
  return {
    id: `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    accountId: "40000000-0000-4000-8000-000000000001",
    date: "2026-11-01",
    amount: "-50.00",
    currency: "UAH",
    counterparty,
    eligible: true,
    imported,
  };
}

describe("BUD-21@PoC FR 19: the suggestions against the space's transactions", () => {
  it("BUD-21@PoC AC21: 300 transactions imported from statements, 12 of them matched by all the suggestions together — the warning about the descriptions, and each suggestion its own count", async () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => transaction(`SILPO ${1000 + i} KYIV`)),
      ...Array.from({ length: 288 }, (_, i) => transaction(`POS ${i} TERMINAL`)),
      // Entered by hand: not «imported from statements», counted for the suggestions only.
      ...Array.from({ length: 3 }, () => transaction("SILPO 7 LVIV", false)),
    ];
    const got = await existingMatches(
      inputsOf(rows),
      HOUSEHOLD,
      [
        [{ field: "merchant", operator: "equals", value: "Сільпо" }],
        [{ field: "description", operator: "contains", value: "ОСББ" }],
      ],
      20_000,
    );
    expect(got.counts).toEqual([15, 0]);
    expect(got.imported).toBe(300);
    expect(got.matchedImported).toBe(12);
    expect(got.descriptionsDiffer).toBe(true);
    expect(got.truncated).toBe(false);
  });

  it("BUD-21@PoC FR 19: the warning needs at least 50 imported transactions and under 10 % of them matched", () => {
    expect(descriptionsDiffer(49, 0)).toBe(false);
    expect(descriptionsDiffer(50, 4)).toBe(true);
    expect(descriptionsDiffer(50, 5)).toBe(false);
    expect(descriptionsDiffer(300, 29)).toBe(true);
    expect(descriptionsDiffer(300, 30)).toBe(false);
  });

  it("BUD-21@PoC FR 19: an amount condition matches only in its currency", async () => {
    const rows = [transaction("Shell"), { ...transaction("Shell"), amount: "-60.00", currency: "EUR" }];
    const got = await existingMatches(
      inputsOf(rows),
      HOUSEHOLD,
      [
        [
          { field: "merchant", operator: "equals", value: "Shell" },
          { field: "amount", operator: "greater", value: Money.of("40", "EUR") },
        ],
      ],
      20_000,
    );
    expect(got.counts).toEqual([1]);
  });
});

describe("BUD-21@PoC FR 20: the suggestions against the space's rules", () => {
  it("BUD-21@PoC AC22: a suggestion with the conditions and the category of a rule is not shown", async () => {
    const rules = [
      rule({
        id: "r1",
        position: 1,
        conditions: [{ field: "merchant", operator: "equals", value: "Netflix" }],
        categoryId: CAT.subscriptions,
      }),
    ];
    const shown = await shownSuggestions(
      allActive,
      HOUSEHOLD,
      [
        stored({ ordinal: 1, conditions: [merchant("netflix ")], categoryId: CAT.subscriptions }),
        stored({ ordinal: 2, conditions: [merchant("Сільпо")], categoryId: CAT.groceries }),
      ],
      rules,
      new Set(),
    );
    expect(shown.map((s) => s.ordinal)).toEqual([2]);
    expect(againstRules(suggestionKey([merchant("Netflix")]), CAT.subscriptions, rules)).toBe("same");
  });

  it("BUD-21@PoC AC23: a suggestion with the conditions of a rule and another category is marked as conflicting with that rule's number and not selected", async () => {
    const rules = [
      rule({
        id: "r1",
        position: 1,
        conditions: [{ field: "merchant", operator: "equals", value: "АТБ" }],
        categoryId: CAT.groceries,
      }),
      rule({
        id: "r3",
        position: 3,
        conditions: [{ field: "merchant", operator: "equals", value: "Spotify" }],
        categoryId: CAT.subscriptions,
      }),
    ];
    const [spotify, silpo] = await shownSuggestions(
      allActive,
      HOUSEHOLD,
      [
        stored({ ordinal: 1, conditions: [merchant("Spotify")], categoryId: CAT.fun }),
        stored({ ordinal: 2, conditions: [merchant("Сільпо")], categoryId: CAT.groceries }),
      ],
      rules,
      new Set(),
    );
    expect(spotify).toMatchObject({ ordinal: 1, conflict: { id: "r3", position: 3 }, selected: false });
    expect(silpo).toMatchObject({ ordinal: 2, conflict: null, selected: true });
  });

  it("BUD-21@PoC FR 21: confident suggestions are selected by default, conflicting ones are not", async () => {
    const shown = await shownSuggestions(
      allActive,
      HOUSEHOLD,
      [
        stored({ ordinal: 1, conditions: [merchant("Сільпо")], categoryId: CAT.groceries }),
        stored({ ordinal: 2, kind: "conflicting", conditions: [merchant("Amazon")], categoryId: CAT.home }),
      ],
      [],
      new Set(),
    );
    expect(shown.map((s) => s.selected)).toEqual([true, false]);
  });

  it("BUD-21@PoC AC26: accepted Shell with an amount threshold (16 rows), Сільпо (15) and АТБ (40) take the order Shell (two conditions), АТБ, Сільпо", () => {
    const shell = {
      conditions: [
        merchant("Shell"),
        {
          field: "amount",
          operator: "greater",
          value: { amount: "40", currency: "EUR" },
        } as SuggestionCondition,
      ],
      matched: 16,
      categoryId: CAT.fuel,
      rows: [1],
    };
    const silpo = { conditions: [merchant("Сільпо")], matched: 15, categoryId: CAT.groceries, rows: [2] };
    const atb = { conditions: [merchant("АТБ")], matched: 40, categoryId: CAT.groceries, rows: [3] };
    expect(acceptanceOrder([silpo, atb, shell])).toEqual([shell, atb, silpo]);
    // A tie on N goes by the merchant's name or the word.
    const ab = { conditions: [merchant("Amazon")], matched: 15, categoryId: CAT.home, rows: [4] };
    expect(acceptanceOrder([silpo, ab]).map((s) => s.conditions[0]!.value)).toEqual(["Amazon", "Сільпо"]);
  });
});

describe("BUD-21@PoC FR 23: a rejected suggestion", () => {
  it("BUD-21@PoC FR 23: a suggestion rejected with the same conditions and category is not shown; another category of the same conditions is", async () => {
    const key = suggestionKey([merchant("Rozetka")]);
    const shown = await shownSuggestions(
      allActive,
      HOUSEHOLD,
      [
        stored({ ordinal: 1, conditions: [merchant("ROZETKA")], categoryId: CAT.home }),
        stored({ ordinal: 2, conditions: [merchant("Rozetka")], categoryId: CAT.fun }),
      ],
      [],
      new Set([`${CAT.home} ${key}`]),
    );
    expect(shown.map((s) => s.ordinal)).toEqual([2]);
  });
});

describe("BUD-21@PoC EC8: the category of a suggestion deleted or merged before the acceptance", () => {
  const MERGED = CAT.cafes;
  const DELETED = CAT.utilities;
  const categories: CategoryFactsPort = {
    category: async (_h, id) =>
      id === DELETED
        ? null
        : id === MERGED
          ? { kind: "expense", state: "retired", mergedInto: CAT.delivery }
          : { kind: "expense", state: "active" },
  };

  it("BUD-21@PoC EC8: a merged category — the suggestion goes to the target category and its rule is written with it", async () => {
    expect(await resolveCategory(categories, HOUSEHOLD, MERGED)).toMatchObject({ id: CAT.delivery });
    const shown = await shownSuggestions(
      categories,
      HOUSEHOLD,
      [stored({ ordinal: 1, conditions: [merchant("Glovo")], categoryId: MERGED })],
      [],
      new Set(),
    );
    expect(shown[0]).toMatchObject({ categoryId: CAT.delivery, categoryDeleted: false, selected: true });
    const accepted = await acceptedRules(
      shown,
      [{ ordinal: 1 }],
      () => "r-new",
      async () => null,
    );
    expect(accepted).toMatchObject({ rules: [{ id: "r-new", categoryId: CAT.delivery }] });
  });

  it("BUD-21@PoC EC8: a deleted category — the suggestion says so, is not selected and its acceptance is refused", async () => {
    const shown = await shownSuggestions(
      categories,
      HOUSEHOLD,
      [
        stored({ ordinal: 1, conditions: [merchant("ОСББ")], categoryId: DELETED }),
        stored({ ordinal: 2, conditions: [merchant("Сільпо")], categoryId: CAT.groceries }),
      ],
      [],
      new Set(),
    );
    expect(shown[0]).toMatchObject({ categoryDeleted: true, selected: false });
    expect(
      await acceptedRules(
        shown,
        [{ ordinal: 2 }, { ordinal: 1 }],
        () => "r",
        async () => null,
      ),
    ).toEqual({
      kind: "category-deleted",
      ordinal: 1,
    });
  });

  it("BUD-21@PoC FR 22: an ordinal not shown or given twice is refused by its place in the request", async () => {
    const shown = await shownSuggestions(
      allActive,
      HOUSEHOLD,
      [stored({ ordinal: 1, conditions: [merchant("Сільпо")], categoryId: CAT.groceries })],
      [],
      new Set(),
    );
    expect(
      await acceptedRules(
        shown,
        [{ ordinal: 9 }],
        () => "r",
        async () => null,
      ),
    ).toEqual({
      kind: "invalid",
      path: "suggestions.0.ordinal",
      issue: "not_found",
    });
    expect(
      await acceptedRules(
        shown,
        [{ ordinal: 1 }, { ordinal: 1 }],
        () => "r",
        async () => null,
      ),
    ).toEqual({
      kind: "invalid",
      path: "suggestions.1.ordinal",
      issue: "duplicate",
    });
  });
});
