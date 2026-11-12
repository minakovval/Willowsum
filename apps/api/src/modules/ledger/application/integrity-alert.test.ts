import { describe, expect, it } from "vitest";
import {
  alertIntegrityFindings,
  integrityAlertMessage,
  integrityPeriodKey,
  type IntegrityAlertEvent,
  type IntegrityAlertStore,
  type IntegrityFindings,
} from "./index.ts";

/**
 * FIN-04@PoC FR 10, AC7 and the edge cases of the letter (owner decision 2026-11-12: PoC alerts are letters from
 * the app): one letter to the product owner per discrepancy period, the claim given back when sending fails, no
 * amounts or ids in the letter, a missing recipient only logged. The clock is injected and fixed per test.
 */

const T0 = Date.UTC(2026, 10, 12, 3, 17, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const findings = (f: Partial<IntegrityFindings> = {}): IntegrityFindings => ({
  "unbalanced-entry": 0,
  "empty-entry": 0,
  "reversal-mismatch": 0,
  ...f,
});

/** The claim log in memory, with the same rules as the database: append-only, the latest row is the state. */
function memoryStore(): IntegrityAlertStore & {
  log: { period: string | null; at: number }[];
  latest(): string | null;
  failClaim: boolean;
} {
  const log: { period: string | null; at: number }[] = [];
  const latest = () => log.at(-1)?.period ?? null;
  const store = {
    log,
    latest,
    failClaim: false,
    async claim(period: string, at: number) {
      if (store.failClaim) throw new Error("db down");
      if (latest() === period) return false;
      log.push({ period, at });
      return true;
    },
    async release(period: string, at: number) {
      if (latest() === period) log.push({ period: null, at });
    },
    async endPeriod(at: number) {
      if (latest() !== null) log.push({ period: null, at });
    },
  };
  return store;
}

function setup(options: { recipient?: boolean } = {}) {
  let now = T0;
  const store = memoryStore();
  const letters: { findings: IntegrityFindings; failedSpaces: number }[] = [];
  const events: IntegrityAlertEvent[] = [];
  let mailDown = false;
  const deps = {
    store,
    clock: { now: () => now },
    report: (event: IntegrityAlertEvent) => events.push(event),
    ...(options.recipient === false
      ? {}
      : {
          alert: async (summary: { findings: IntegrityFindings; failedSpaces: number }) => {
            if (mailDown) throw new TypeError("mail down");
            letters.push(summary);
          },
        }),
  };
  return {
    store,
    letters,
    events,
    nextDay: () => {
      now += DAY;
    },
    setMailDown: (down: boolean) => {
      mailDown = down;
    },
    run: (f: IntegrityFindings, failedSpaces = 0) => alertIntegrityFindings(deps, f, failedSpaces),
  };
}

describe("FIN-04@PoC FR 10: one letter to the product owner per discrepancy period", () => {
  it("FIN-04@PoC AC7: a discrepancy sends one letter with the kinds and counts; the claim holds the clock's time", async () => {
    const t = setup();
    await t.run(findings({ "unbalanced-entry": 2 }), 1);
    expect(t.letters).toEqual([{ findings: findings({ "unbalanced-entry": 2 }), failedSpaces: 1 }]);
    expect(t.events).toEqual([{ kind: "alert-sent" }]);
    expect(t.store.log).toEqual([{ period: "unbalanced-entry=2;empty-entry=0;reversal-mismatch=0", at: T0 }]);
  });

  it("FIN-04@PoC AC7: the same findings on the next daily runs send no more letters", async () => {
    const t = setup();
    const same = findings({ "empty-entry": 1, "reversal-mismatch": 3 });
    await t.run(same);
    for (let day = 0; day < 5; day++) {
      t.nextDay();
      // A changing number of spaces that could not be checked is no new period.
      await t.run(same, day % 2);
    }
    expect(t.letters).toHaveLength(1);
    expect(t.events.filter((e) => e.kind === "alert-sent")).toHaveLength(1);
  });

  it("FIN-04@PoC FR 10: changed findings start a new period and send a new letter", async () => {
    const t = setup();
    await t.run(findings({ "unbalanced-entry": 1 }));
    t.nextDay();
    await t.run(findings({ "unbalanced-entry": 2 }));
    t.nextDay();
    await t.run(findings({ "unbalanced-entry": 2, "empty-entry": 1 }));
    t.nextDay();
    // Back to the first findings: the period of the second has ended, so this is news again.
    await t.run(findings({ "unbalanced-entry": 1 }));
    expect(t.letters.map((l) => l.findings["unbalanced-entry"])).toEqual([1, 2, 2, 1]);
  });

  it("FIN-04@PoC FR 10: a clean run ends the period; the same discrepancy later sends a letter again", async () => {
    const t = setup();
    const broken = findings({ "reversal-mismatch": 1 });
    await t.run(broken);
    t.nextDay();
    await t.run(findings());
    expect(t.store.latest()).toBeNull();
    expect(t.store.log.at(-1)).toEqual({ period: null, at: T0 + DAY });
    t.nextDay();
    await t.run(broken);
    expect(t.letters).toHaveLength(2);
  });

  it("FIN-04@PoC FR 10: a run where some spaces failed is not clean — the period goes on, no letter of its own", async () => {
    const t = setup();
    const broken = findings({ "reversal-mismatch": 1 });
    await t.run(broken);
    t.nextDay();
    // Nothing found, but 2 spaces could not be checked: the discrepancy may still be there.
    await t.run(findings(), 2);
    expect(t.store.latest()).toBe("unbalanced-entry=0;empty-entry=0;reversal-mismatch=1");
    t.nextDay();
    await t.run(broken);
    expect(t.letters).toHaveLength(1);
  });

  it("a clean journal sends nothing and reports nothing", async () => {
    const t = setup();
    await t.run(findings());
    expect(t.letters).toEqual([]);
    expect(t.events).toEqual([]);
  });
});

describe("FIN-04@PoC EC4: the letter could not be sent — the claim is released, the next run sends it", () => {
  it("a failed send reports alert-failed with the error class only, and gives the claim back", async () => {
    const t = setup();
    const broken = findings({ "unbalanced-entry": 1 });
    t.setMailDown(true);
    await t.run(broken);
    expect(t.events).toEqual([{ kind: "alert-failed", errorClass: "TypeError" }]);
    expect(t.store.latest()).toBeNull();
    t.nextDay();
    t.setMailDown(false);
    await t.run(broken);
    expect(t.letters).toHaveLength(1);
    expect(t.events.at(-1)).toEqual({ kind: "alert-sent" });
  });

  it("a failed claim (the database) reports alert-failed and sends nothing; the check does not throw", async () => {
    const t = setup();
    t.store.failClaim = true;
    await expect(t.run(findings({ "unbalanced-entry": 1 }))).resolves.toBeUndefined();
    expect(t.letters).toEqual([]);
    expect(t.events).toEqual([{ kind: "alert-failed", errorClass: "Error" }]);
  });
});

describe("FIN-04@PoC EC5: no recipient configured — an error event, no letter, no crash", () => {
  it("a discrepancy without a recipient reports recipient-missing and claims nothing", async () => {
    const t = setup({ recipient: false });
    await expect(t.run(findings({ "empty-entry": 1 }))).resolves.toBeUndefined();
    expect(t.events).toEqual([{ kind: "recipient-missing" }]);
    expect(t.store.log).toEqual([]);
  });

  it("a clean journal without a recipient reports nothing", async () => {
    const t = setup({ recipient: false });
    await t.run(findings());
    expect(t.events).toEqual([]);
  });
});

describe("FIN-04@PoC FR 10: the letter and the period key hold only the kinds and counts of findings", () => {
  it("the letter names each failing check with its count, and the spaces that could not be checked", () => {
    const letter = integrityAlertMessage({
      findings: findings({ "unbalanced-entry": 3, "reversal-mismatch": 1 }),
      failedSpaces: 2,
    });
    expect(letter.subject).toBe("Willowsum: перевірка цілісності журналу знайшла розбіжність");
    expect(letter.text).toContain("Незбалансований запис: 3.");
    expect(letter.text).toContain("Сторно не збігається з початковим записом: 1.");
    expect(letter.text).not.toContain("Запис без проводок");
    expect(letter.text).toContain("Просторів, які не вдалося перевірити: 2.");
    expect(letter.text).toContain("ledger.integrity_violation");
  });

  it("no amounts, currencies, ids or space data: only small integers and fixed words", () => {
    const letter = integrityAlertMessage({
      findings: findings({ "unbalanced-entry": 12, "empty-entry": 7, "reversal-mismatch": 1 }),
      failedSpaces: 0,
    });
    const all = `${letter.subject}\n${letter.text}`;
    expect(all).not.toMatch(/\d+[.,]\d+/);
    expect(all).not.toMatch(/[$€£₴]|\b(UAH|EUR|USD|PLN|GBP|CHF|грн)\b/i);
    expect(all).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(all).not.toMatch(/@/);
    expect(letter.text).not.toContain("Просторів, які не вдалося перевірити");
  });

  it("the period key is the kinds and counts of the findings, in a fixed order", () => {
    expect(integrityPeriodKey(findings({ "reversal-mismatch": 2, "unbalanced-entry": 1 }))).toBe(
      "unbalanced-entry=1;empty-entry=0;reversal-mismatch=2",
    );
  });
});
