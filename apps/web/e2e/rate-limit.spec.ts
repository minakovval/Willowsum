import { expect, test } from "./fixtures.ts";

/**
 * NFR-14@PoC AC1 and FR 8 through the deployed shape of the stack: the browser reaches the API through the web
 * origin's proxy, and the API takes the client's address from that one trusted hop. Every test is its own client
 * (fixtures.ts), so a test that uses up its public budget never takes another test's. Before, every test and both
 * browser projects in one API process shared the proxy's address: WebKit's last sign-ups were refused once the run
 * passed 60 public requests in one minute (#357, #370).
 */
test.describe.serial("NFR-14@PoC: the public limit per client address behind the trusted proxy", () => {
  test("NFR-14@PoC AC1: the 61st public request in a minute is refused with 429 and Retry-After", async ({
    page,
  }) => {
    await page.goto("/#/login");
    const answers = await page.evaluate(async () => {
      // Windows are fixed minutes since the epoch (FR 5) on this host's clock, which the API shares: a burst
      // starts with at least 10 s of its window left, so all 61 requests fall into one window.
      const left = 60_000 - (Date.now() % 60_000);
      if (left < 10_000) await new Promise((resolve) => setTimeout(resolve, left + 200));
      const out: { status: number; retryAfter: string | null }[] = [];
      for (let i = 0; i < 61; i++) {
        const r = await fetch("/v1/meta");
        out.push({ status: r.status, retryAfter: r.headers.get("retry-after") });
      }
      return out;
    });
    expect(answers.slice(0, 60).map((a) => a.status)).toEqual(Array<number>(60).fill(200));
    expect(answers[60]?.status).toBe(429);
    expect(answers[60]?.retryAfter).toMatch(/^[1-9][0-9]*$/);
  });

  test("NFR-14@PoC FR 8: the next client, by its forwarded address, still has its own budget", async ({
    page,
  }) => {
    await page.goto("/#/login");
    expect(await page.evaluate(() => fetch("/v1/meta").then((r) => r.status))).toBe(200);
  });
});
