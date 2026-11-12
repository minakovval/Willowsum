import { readFileSync } from "node:fs";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { syntheticMailSender } from "../../platform/adapters/mail/index.ts";
import { recordingFetch } from "../../platform/adapters/testing.ts";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { nbuRateFeed } from "./adapters/index.ts";
import {
  createFxRates,
  startFxRatesRefresh,
  type FxClock,
  type FxRateFeed,
  type FxRefreshEvent,
} from "./index.ts";

/**
 * VAL-05@PoC on a real PostgreSQL: the update task writes the rate history (date and source) into the module's
 * own schema, and reading converts through the hryvnia from that history only. The test owns the clock (`t`); the
 * NBU answers from a recorded fixture through a recording fetch, so nothing leaves the machine.
 */
const RECORDED = readFileSync(
  new URL("./adapters/feeds/fixtures/nbu-exchange-2026-11-12.json", import.meta.url),
  "utf8",
);
const HOUR = 60 * 60 * 1000;

let db: RealModulesDatabase;
let t = Date.UTC(2026, 10, 12, 14, 0);
const clock: FxClock = {
  now: () => t,
  // Retry pauses of the adapter fire at once; the loop's own timers and the 10 s call limit never fire here.
  setTimeout: (callback, ms) => {
    if (ms < 10_000) queueMicrotask(callback);
    return 0;
  },
  clearTimeout: () => undefined,
};

let nbuUp = true;
let recorder: ReturnType<typeof recordingFetch>;
const events: FxRefreshEvent[] = [];

function nbu(): FxRateFeed {
  recorder = recordingFetch(() =>
    nbuUp
      ? new Response(RECORDED, { headers: { "content-type": "application/json" } })
      : new Response("", { status: 503 }),
  );
  return nbuRateFeed({ fetch: recorder.fetch, clock, random: () => 0 });
}

const mail = syntheticMailSender();
const OWNER = "owner@example.test";

async function updateWith(feed: FxRateFeed) {
  const loop = startFxRatesRefresh({
    db: db.databases.for("fx-rates"),
    mode: "test",
    feed,
    clock,
    report: (e) => events.push(e),
    alertMail: { mail, to: OWNER },
  });
  const outcome = await loop.attempt();
  await loop.stop();
  return outcome;
}

const reader = () => createFxRates({ db: db.databases.for("fx-rates"), now: () => t });

beforeAll(async () => {
  db = await setupRealModules();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.owner.query("TRUNCATE fx_rates.rates, fx_rates.updates, fx_rates.stale_alerts");
  t = Date.UTC(2026, 10, 12, 14, 0);
  nbuUp = true;
  events.length = 0;
  mail.clear();
});

describe("VAL-05@PoC: exchange rate feed and history (real PostgreSQL)", () => {
  it("VAL-05 AC1: the daily task loads the rates of all supported currencies with their date and source", async () => {
    expect(await updateWith(nbu())).toBe("updated");
    const { rows } = await db.owner.query(
      `SELECT currency, rate::text AS rate, to_char(rate_date, 'YYYY-MM-DD') AS d, source FROM fx_rates.rates ORDER BY currency`,
    );
    expect(rows).toEqual([
      { currency: "EUR", rate: "45.000000000000000000", d: "2026-11-12", source: "NBU" },
      { currency: "JPY", rate: "0.270130000000000000", d: "2026-11-12", source: "NBU" },
      { currency: "PLN", rate: "11.250000000000000000", d: "2026-11-12", source: "NBU" },
      { currency: "USD", rate: "41.432100000000000000", d: "2026-11-12", source: "NBU" },
      { currency: "XAU", rate: "110385.170000000000000000", d: "2026-11-12", source: "NBU" },
    ]);
    const updates = await db.owner.query(`SELECT feed, currencies, completed_at FROM fx_rates.updates`);
    expect(updates.rows).toEqual([{ feed: "nbu", currencies: 5, completed_at: new Date(t) }]);
  });

  it("VAL-05 AC5: 1 EUR = 45.00 UAH and 1 PLN = 11.25 UAH on D → a PLN account in EUR uses 1 PLN = 0.25 EUR, source NBU, date D, no ECB request", async () => {
    await updateWith(nbu());
    const { conversion } = await reader().convert(Money.of("1000.00", "PLN"), "EUR", "2026-11-12");
    expect([
      conversion.rate.toFixed(),
      conversion.source,
      conversion.rateDate,
      conversion.to.toDecimalString(),
    ]).toEqual(["0.25", "NBU", "2026-11-12", "250"]);
    expect(conversion.from.currency).toBe("PLN");
    expect(recorder.requests.map((r) => new URL(r.url).host)).toEqual(["bank.gov.ua"]);
  });

  it("VAL-05 FR3: the nearest earlier rate is used for a date without rates, marked approximate; never a later one", async () => {
    await updateWith(nbu());
    const { conversion } = await reader().convert(Money.of("100", "EUR"), "UAH", "2026-11-15");
    expect([conversion.rateDate, conversion.approximate, conversion.to.toDecimalString()]).toEqual([
      "2026-11-12",
      true,
      "4500",
    ]);
    await expect(reader().rate("EUR", "UAH", "2026-11-11")).rejects.toThrow(/No rate/);
    await expect(reader().rate("GBP", "EUR", "2026-11-12")).rejects.toThrow(/No rate/);
  });

  it("VAL-05 AC2, AC4: with the provider down the task fails, amounts still use the last successful rates and the date of the last update", async () => {
    await updateWith(nbu());
    const updatedAt = new Date(t).toISOString();
    t += 25 * HOUR;
    nbuUp = false;
    expect(await updateWith(nbu())).toBe("failed");
    expect(recorder.requests.length).toBeGreaterThan(1); // retried by the adapter
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["stale", "alert-sent"]));

    const shown = await reader().convert(Money.of("1000.00", "PLN"), "EUR", "2026-11-13");
    expect([
      shown.conversion.rate.toFixed(),
      shown.conversion.rateDate,
      shown.updatedAt,
      shown.stale,
    ]).toEqual(["0.25", "2026-11-12", updatedAt, true]);
    expect(await reader().freshness()).toEqual({ updatedAt, stale: true });
  });

  it("VAL-05 AC3: another provider connected through the abstraction — readers see the same rates, the history stays", async () => {
    await updateWith(nbu());
    const before = await reader().rate("PLN", "EUR", "2026-11-12");
    // A replacement source behind the same interface, publishing the same official rates of the next day.
    const replacement: FxRateFeed = {
      name: "replacement",
      dailyRates: async (date) => (await nbu().dailyRates("2026-11-12")).map((r) => ({ ...r, date })),
    };
    t += 24 * HOUR;
    expect(await updateWith(replacement)).toBe("updated");
    const old = await reader().rate("PLN", "EUR", "2026-11-12");
    const next = await reader().rate("PLN", "EUR", "2026-11-13");
    expect([old.rate.rate.toFixed(), old.rate.source, old.rate.date]).toEqual(["0.25", "NBU", "2026-11-12"]);
    expect([next.rate.rate.toFixed(), next.rate.source, next.rate.date]).toEqual([
      "0.25",
      "NBU",
      "2026-11-13",
    ]);
    expect(Object.keys(next).sort()).toEqual(Object.keys(before).sort());
    const { rows } = await db.owner.query(`SELECT feed FROM fx_rates.updates ORDER BY completed_at`);
    expect(rows.map((r) => r.feed)).toEqual(["nbu", "replacement"]);
  });

  it("VAL-05 FR1: the synthetic feed (local, CI) fills the history without any network", async () => {
    const loop = startFxRatesRefresh({
      db: db.databases.for("fx-rates"),
      mode: "test",
      clock,
      report: () => undefined,
    });
    expect(await loop.attempt()).toBe("updated");
    await loop.stop();
    const { rows } = await db.owner.query(`SELECT DISTINCT source FROM fx_rates.rates`);
    expect(rows).toEqual([{ source: "synthetic" }]);
  });

  it("VAL-05 AC2: after 24 h without success the owner gets one letter without amounts; later failures and a restart send none", async () => {
    await updateWith(nbu());
    nbuUp = false;
    t += 23 * HOUR;
    expect(await updateWith(nbu())).toBe("failed");
    expect(mail.sent).toHaveLength(0); // less than 24 h: retries only
    for (let i = 0; i < 4; i++) {
      t += 2 * HOUR;
      expect(await updateWith(nbu())).toBe("failed"); // each call is a fresh loop, as after a restart
    }
    expect(mail.sent).toHaveLength(1);
    const [letter] = mail.sent;
    expect(letter!.to).toBe(OWNER);
    expect(letter!.text).toContain("Останнє успішне оновлення: 2026-11-12 14:00 UTC.");
    expect(`${letter!.subject} ${letter!.text}`).not.toMatch(/\d+[.,]\d+|\b(UAH|EUR|PLN|USD)\b/);
    expect(events.filter((e) => e.kind === "stale").length).toBe(4);

    nbuUp = true;
    expect(await updateWith(nbu())).toBe("updated");
    nbuUp = false;
    t += 25 * HOUR;
    await updateWith(nbu());
    expect(mail.sent).toHaveLength(2); // a new stale period
  });
});
