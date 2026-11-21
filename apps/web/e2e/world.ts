import { createHash, randomBytes } from "node:crypto";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { clearSignUpLimits, confirmationLinkFor, ownerQuery } from "../../api/test/e2e-support.ts";
import { h1, signIn, signUp } from "./fixtures.ts";

/**
 * A synthetic space for the end-to-end tests of whole flows (FLW-38@PoC, FLW-44@PoC): a person who signs up, confirms
 * and signs in through the screens, then a state built through the real API — accounts, categorised transactions, a
 * budget — in the real browser's session. What the product reaches only with time (a budget that began months ago) is
 * moved back in the database as its owner (`ownerQuery`); nothing else is written there. The clock is the machine's
 * (the stack has no other), so every date of a test is computed from `today` and the months before it. Synthetic names
 * and amounts only.
 */
function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: run the tests through e2e/playwright.config.ts`);
  return value;
}

export interface Money {
  readonly amount: string;
  readonly currency: string;
}
export const eur = (amount: string): Money => ({ amount, currency: "EUR" });

/** Today's date in Europe/Kyiv (the day the API counts, П-24), `YYYY-MM-DD`. */
export function kyivToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
}
export const monthOf = (date: string): string => date.slice(0, 7);
/** `2026-11` shifted by `by` months. */
export function shiftMonth(month: string, by: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
export const daysIn = (month: string): number =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
export const dayOf = (month: string, day: number): string => `${month}-${String(day).padStart(2, "0")}`;

export class World {
  private categories: Map<string, string> | undefined;
  /** The client address of the seeding requests: the per-address limit (NFR-14 FR 5) counts them apart from the page's. */
  private readonly seedAddress: string;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly databaseUrl: string;
  readonly baseUrl: string;
  readonly email: string;

  private constructor(
    context: BrowserContext,
    page: Page,
    databaseUrl: string,
    baseUrl: string,
    email: string,
  ) {
    this.context = context;
    this.page = page;
    this.databaseUrl = databaseUrl;
    this.baseUrl = baseUrl;
    this.email = email;
    const h = createHash("sha256").update(randomBytes(8)).digest("hex");
    this.seedAddress = `2001:db8:${h.slice(0, 4)}:${h.slice(4, 8)}::1`;
  }

  /** A new person, signed in, with a space; the stack has every flag on (e2e-support.ts). */
  static async create(browser: Browser): Promise<World> {
    const baseUrl = env("WS_E2E_BASE_URL");
    const databaseUrl = env("WS_E2E_DATABASE_URL");
    const address = createHash("sha256").update(randomBytes(8)).digest("hex");
    const context = await browser.newContext({
      baseURL: baseUrl,
      ignoreHTTPSErrors: true,
      locale: "uk-UA",
      timezoneId: "Europe/Kyiv",
      colorScheme: "light",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "X-Forwarded-For": `2001:db8:${address.slice(0, 4)}:${address.slice(4, 8)}::1` },
    });
    const page = await context.newPage();
    await clearSignUpLimits(databaseUrl);
    const who = {
      name: "Олена Синтетична",
      email: `e2e.${randomBytes(6).toString("hex")}@example.test`,
      password: ["synthetic", "end", "to", "end", randomBytes(4).toString("hex")].join(" "),
    };
    await signUp(page, who);
    await page.goto(await confirmationLinkFor(databaseUrl, who.email, baseUrl));
    await expect(h1(page)).toHaveText("Email підтверджено");
    await signIn(page, who.email, who.password);
    await expect(page).toHaveURL(/#\/planning\/budget/);
    return new World(context, page, databaseUrl, baseUrl, who.email);
  }

  async close(): Promise<void> {
    await this.context.close();
  }

  /** The API as the signed-in person; a status outside `expected` fails the test with the body. */
  async api<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    body?: unknown,
    expected: readonly number[] = [200, 201, 204],
  ): Promise<T> {
    const res = await this.page.request.fetch(url, {
      method,
      headers: {
        origin: this.baseUrl,
        "X-Forwarded-For": this.seedAddress,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { data: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    expect(expected, `${method} ${url} -> ${res.status()} ${text}`).toContain(res.status());
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** The space's id (for the owner's queries). */
  async householdId(): Promise<string> {
    const rows = await ownerQuery(
      this.databaseUrl,
      `SELECT s.space_id FROM household.account_spaces s JOIN identity.accounts a ON a.id = s.account_id
        WHERE a.email_normalized = lower($1)`,
      [this.email],
    );
    return String(rows[0]!["space_id"]);
  }

  async account(body: Record<string, unknown>): Promise<string> {
    const created = await this.api<{ id: string }>("POST", "/v1/accounts", body);
    return created.id;
  }

  async categoryId(name: string): Promise<string> {
    if (!this.categories) {
      const tree = await this.api<{ groups: { categories: { id: string; name: string }[] }[] }>(
        "GET",
        "/v1/categories",
      );
      this.categories = new Map(tree.groups.flatMap((g) => g.categories).map((c) => [c.name, c.id]));
    }
    const id = this.categories.get(name);
    expect(id, `category «${name}»`).toBeDefined();
    return id!;
  }

  /** A transaction (negative amount — an expense) in `category` (null — «Без категорії»). */
  async transaction(
    accountId: string,
    amount: string,
    date: string,
    category: string | null,
    counterparty = "Синтетичний продавець",
  ): Promise<string> {
    const created = await this.api<{ id: string }>("POST", "/v1/transactions", {
      accountId,
      amount: eur(amount),
      date,
      counterparty,
    });
    if (category !== null)
      await this.api("PUT", `/v1/transactions/${created.id}/category`, {
        categoryId: await this.categoryId(category),
      });
    return created.id;
  }

  /**
   * The budget as if it had begun in `from` (a month `YYYY-MM` before this one): created now through the API, then its
   * first period and creation day moved back; the snapshots of the finished months are written when they are first read.
   */
  async budgetSince(from: string, body: Record<string, unknown>): Promise<void> {
    await this.api("POST", "/v1/budget", { firstPeriod: monthOf(kyivToday()), ...body }, [201]);
    await ownerQuery(
      this.databaseUrl,
      `UPDATE budget.budgets SET first_period = $2, created_on = $2, first_day = NULL WHERE household_id = $1`,
      [await this.householdId(), `${from}-01`],
    );
  }
}
