import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  conditionKey,
  firstRule,
  moved,
  RUN_FOREGROUND_MAX,
  rulesFor,
  ruleMatches,
  undoState,
  withTags,
  type RankedRule,
  type RuleCondition,
  type RuleSubject,
} from "./index.ts";

/** BUD-14@PoC b) (wave 2 row 23): category rules — pure rules. Names, amounts and ids are synthetic. */
const AMEX = "0f0a5c3f-2b10-4c1e-9a77-8a6f4f6e1001";
const CURRENT = "0f0a5c3f-2b10-4c1e-9a77-8a6f4f6e1002";
const GROCERIES = "0f0a5c3f-2b10-4c1e-9a77-8a6f4f6e2001";
const HOME = "0f0a5c3f-2b10-4c1e-9a77-8a6f4f6e2002";

const eur = (amount: string) => Money.of(amount, "EUR");
const subject = (over: Partial<RuleSubject> = {}): RuleSubject => ({
  merchant: "Adobe",
  description: "PAYPAL *ADOBE SYSTEMS 4029357733",
  amount: eur("-59.99"),
  accountId: CURRENT,
  ...over,
});
const rule = (
  id: string,
  conditions: RuleCondition[],
  categoryId: string,
  over: Partial<RankedRule> = {},
): RankedRule => ({ id, conditions, accountIds: [], categoryId, enabled: true, ...over });

describe("BUD-14@PoC FR 5: conditions — fields, operators, «І»", () => {
  it("BUD-14@PoC FR 5: «Мерчант» and «Опис» with «дорівнює» and «містить» ignore case", () => {
    const m = (operator: "equals" | "contains", value: string) =>
      ruleMatches({ conditions: [{ field: "merchant", operator, value }], accountIds: [] }, subject());
    expect(m("equals", "adobe")).toBe(true);
    expect(m("equals", "Adob")).toBe(false);
    expect(m("contains", "DOB")).toBe(true);
    const d = ruleMatches(
      { conditions: [{ field: "description", operator: "contains", value: "adobe sys" }], accountIds: [] },
      subject(),
    );
    expect(d).toBe(true);
    // No merchant (no description) — a text condition does not hold.
    expect(
      ruleMatches(
        { conditions: [{ field: "merchant", operator: "contains", value: "a" }], accountIds: [] },
        subject({ merchant: null, description: null }),
      ),
    ).toBe(false);
  });

  it("BUD-14@PoC FR 5: «Сума» compares the amount without its sign in the rule's currency; another currency never matches", () => {
    const a = (operator: "equals" | "greater" | "less", value: Money, s = subject()) =>
      ruleMatches({ conditions: [{ field: "amount", operator, value }], accountIds: [] }, s);
    expect(a("greater", eur("50"))).toBe(true);
    expect(a("less", eur("50"))).toBe(false);
    expect(a("equals", eur("59.990"))).toBe(true);
    expect(a("greater", eur("59.99"))).toBe(false);
    expect(a("greater", eur("50"), subject({ amount: eur("120.00") }))).toBe(true);
    expect(a("greater", Money.of("50", "USD"))).toBe(false);
    expect(a("less", Money.of("500", "USD"))).toBe(false);
  });

  it("BUD-14@PoC FR 5: all conditions must hold («І»); «Рахунок» and «Лише для рахунків» pick the account", () => {
    const both: RuleCondition[] = [
      { field: "merchant", operator: "contains", value: "Adobe" },
      { field: "amount", operator: "greater", value: eur("50") },
    ];
    expect(ruleMatches({ conditions: both, accountIds: [] }, subject())).toBe(true);
    expect(ruleMatches({ conditions: both, accountIds: [] }, subject({ amount: eur("-9.99") }))).toBe(false);
    const onAmex: RuleCondition[] = [{ field: "account", operator: "equals", value: AMEX }];
    expect(ruleMatches({ conditions: onAmex, accountIds: [] }, subject())).toBe(false);
    expect(ruleMatches({ conditions: onAmex, accountIds: [] }, subject({ accountId: AMEX }))).toBe(true);
    expect(ruleMatches({ conditions: both, accountIds: [AMEX] }, subject())).toBe(false);
    expect(ruleMatches({ conditions: both, accountIds: [AMEX, CURRENT] }, subject())).toBe(true);
  });
});

describe("BUD-14@PoC FR 8: new transactions go through the rules in priority order", () => {
  it("BUD-14@PoC FR 8: the first matching rule sets the category; a lower one matching too does not", async () => {
    const rules = [
      rule("r1", [{ field: "merchant", operator: "contains", value: "Costco" }], GROCERIES),
      rule(
        "r2",
        [
          { field: "account", operator: "equals", value: AMEX },
          { field: "amount", operator: "greater", value: eur("200") },
        ],
        HOME,
      ),
    ];
    const costco = subject({ merchant: "Costco", amount: eur("-312.00"), accountId: AMEX });
    expect((await firstRule(rules, costco, async () => null))?.id).toBe("r1");
    expect((await firstRule([...rules].reverse(), costco, async () => null))?.id).toBe("r2");
    expect(await firstRule(rules, subject(), async () => null)).toBeNull();
  });

  it("BUD-14@PoC AC12: a disabled rule is not applied to a new transaction", async () => {
    const rules = [
      rule("r1", [{ field: "merchant", operator: "equals", value: "Adobe" }], HOME, { enabled: false }),
    ];
    expect(await firstRule(rules, subject(), async () => null)).toBeNull();
  });

  it("BUD-14@PoC FR 10: a rule that needs attention is skipped and the next one decides; attention is asked of matching rules only", async () => {
    const asked: string[] = [];
    const rules = [
      rule("r0", [{ field: "merchant", operator: "equals", value: "Other" }], HOME),
      rule("r1", [{ field: "merchant", operator: "equals", value: "Adobe" }], HOME),
      rule("r2", [{ field: "merchant", operator: "contains", value: "ado" }], GROCERIES),
    ];
    const found = await firstRule(rules, subject(), async (r) => {
      asked.push(r.id);
      return r.id === "r1" ? "category_deleted" : null;
    });
    expect(found?.id).toBe("r2");
    expect(asked).toEqual(["r1", "r2"]);
  });
});

describe("BUD-14@PoC FR 11: identical conditions", () => {
  it("BUD-14@PoC FR 11: the key ignores the order, spacing and case of the conditions and the trailing zeros of an amount", () => {
    const a = conditionKey({
      conditions: [
        { field: "merchant", operator: "contains", value: "Netflix" },
        { field: "amount", operator: "greater", value: eur("10.00") },
      ],
      accountIds: [CURRENT, AMEX],
    });
    const b = conditionKey({
      conditions: [
        { field: "amount", operator: "greater", value: eur("10") },
        { field: "merchant", operator: "contains", value: "  NETFLIX " },
      ],
      accountIds: [AMEX, CURRENT],
    });
    expect(a).toBe(b);
    expect(
      conditionKey({
        conditions: [{ field: "merchant", operator: "equals", value: "Netflix" }],
        accountIds: [],
      }),
    ).not.toBe(
      conditionKey({
        conditions: [{ field: "merchant", operator: "contains", value: "Netflix" }],
        accountIds: [],
      }),
    );
  });
});

describe("BUD-14@PoC FR 4: the order is the priority", () => {
  it("BUD-14@PoC FR 4: a move puts the rule at the position and shifts the others", () => {
    expect(moved(["a", "b", "c", "d", "e"], "e", 1)).toEqual(["e", "a", "b", "c", "d"]);
    expect(moved(["a", "b", "c"], "a", 2)).toEqual(["b", "a", "c"]);
    expect(moved(["a", "b", "c"], "b", 3)).toEqual(["a", "c", "b"]);
  });
});

describe("BUD-14@PoC FR 8: each attribute from the first rule that sets it", () => {
  it("BUD-14@PoC AC3: №1 «Мерчант містить Costco → Продукти», №2 «Рахунок = Amex · сума більше за 200 € → тег «великі», Дім» — the category from №1, the tag from №2, both applied", async () => {
    const costco = subject({
      merchant: "Costco",
      description: "COSTCO WHOLESALE 0042",
      amount: eur("-312.00"),
      accountId: AMEX,
    });
    const r1 = rule("r1", [{ field: "merchant", operator: "contains", value: "Costco" }], GROCERIES);
    const r2 = {
      ...rule(
        "r2",
        [
          { field: "account", operator: "equals", value: AMEX },
          { field: "amount", operator: "greater", value: eur("200") },
        ],
        HOME,
      ),
      tags: ["великі"],
    };
    const chosen = await rulesFor([r1, r2], costco, async () => null);
    expect(chosen.category?.id).toBe("r1");
    expect(chosen.tags?.id).toBe("r2");
    // A rule without tags sets no tags; a lower one with tags would.
    expect((await rulesFor([r1], costco, async () => null)).tags).toBeNull();
    // A higher rule with tags wins the tags too; one that needs attention sets neither.
    const r0 = {
      ...rule("r0", [{ field: "merchant", operator: "equals", value: "costco" }], HOME),
      tags: ["опт"],
    };
    const top = await rulesFor([r0, r1, r2], costco, async (r) =>
      r.id === "r0" ? "category_deleted" : null,
    );
    expect([top.category?.id, top.tags?.id]).toEqual(["r1", "r2"]);
  });

  it("BUD-14@PoC FR 9: the tags of a rule are added after the transaction's own, the same tag once without regard to case; at most 20", () => {
    expect(withTags(["Софт"], ["софт", "робота"])).toEqual(["Софт", "робота"]);
    expect(withTags(["a"], ["A"])).toEqual(["a"]);
    const twenty = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(withTags(twenty, ["new"])).toBeNull();
  });
});

describe("BUD-14@PoC FR 7: «Застосувати до N наявних транзакцій» and «Відмінити»", () => {
  it("BUD-14@PoC EC1: up to 500 transactions at once, the rest in the background", () => {
    expect(RUN_FOREGROUND_MAX).toBe(500);
  });

  it("BUD-14@PoC AC6: «Відмінити» for 7 days after the run ended — 8 days later «Час для відміни минув»; a run undone once is «Запуск уже відмінено»", () => {
    const ended = Date.parse("2026-10-09T10:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    expect(undoState({ status: "completed", endedAt: ended }, ended + 6 * day)).toBe("available");
    expect(undoState({ status: "completed", endedAt: ended }, ended + 7 * day)).toBe("available");
    expect(undoState({ status: "completed", endedAt: ended }, ended + 8 * day)).toBe("expired");
    expect(undoState({ status: "undone", endedAt: ended }, ended + day)).toBe("undone");
    expect(undoState({ status: "undoing", endedAt: ended }, ended + day)).toBe("undone");
    expect(undoState({ status: "running", endedAt: null }, ended)).toBe("running");
  });
});
