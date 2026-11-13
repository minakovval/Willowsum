import { browserSupport, MAX_CHECK_AGE_DAYS, SUPPORT_WINDOW_MONTHS, SUPPORTED_BROWSERS } from "./support.ts";

/** NFR-07@PoC EC1: which browsers the PoC supports (FR 1: Chrome, Safari and Edge released in the last 3 months). */
const chrome = (v: string) =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
const edge = (v: string) => `${chrome(v)} Edg/${v}`;
const safari = (v: string) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v} Safari/605.1.15`;
const firefox = (v: string) =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${v}) Gecko/20100101 Firefox/${v}`;

const minChromium = SUPPORTED_BROWSERS.chromium.version;
const minSafari = SUPPORTED_BROWSERS.safari.version;

describe("NFR-07@PoC EC1: browser support detection", () => {
  it("NFR-07@PoC EC1: Chrome and Edge from the oldest supported version are supported", () => {
    expect(browserSupport(chrome(`${minChromium}.0.0.0`))).toBe("supported");
    expect(browserSupport(chrome(`${minChromium + 2}.0.8010.12`))).toBe("supported");
    expect(browserSupport(edge(`${minChromium}.0.0.0`))).toBe("supported");
  });

  it("NFR-07@PoC EC1: other Chromium-based browsers count by their Chromium version", () => {
    expect(browserSupport(`${chrome(`${minChromium}.0.0.0`)} OPR/${minChromium - 15}.0.0.0`)).toBe(
      "supported",
    );
  });

  it("NFR-07@PoC EC1: Safari from the oldest supported version is supported", () => {
    expect(browserSupport(safari(`${minSafari}.0`))).toBe("supported");
    expect(browserSupport(safari(`${minSafari}.6`))).toBe("supported");
    expect(browserSupport(safari(`${minSafari + 1}.1`))).toBe("supported");
  });

  it("NFR-07@PoC EC1: older Chrome, Edge and Safari are unsupported", () => {
    expect(browserSupport(chrome(`${minChromium - 1}.0.0.0`))).toBe("unsupported");
    expect(browserSupport(edge(`${minChromium - 1}.0.0.0`))).toBe("unsupported");
    expect(browserSupport(safari(`${minSafari - 1}.4`))).toBe("unsupported");
  });

  it("NFR-07@PoC EC1: Firefox is unsupported in PoC (it joins in PoC v2)", () => {
    expect(browserSupport(firefox("155.0"))).toBe("unsupported");
    expect(browserSupport(`${safari(`${minSafari}.0`)} FxiOS/150.0`)).toBe("unsupported");
  });

  it("NFR-07@PoC EC1: an unknown or empty user agent is unsupported", () => {
    expect(browserSupport("")).toBe("unsupported");
    expect(browserSupport("Mozilla/5.0 (linux) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/29.1.1")).toBe(
      "unsupported",
    );
    expect(browserSupport("curl/8.0")).toBe("unsupported");
  });
});

/** The first day of the support window: the check date minus 3 months (UTC calendar dates). */
function windowStart(checkedOn: string): string {
  const d = new Date(`${checkedOn}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - SUPPORT_WINDOW_MONTHS);
  return d.toISOString().slice(0, 10);
}

describe("NFR-07@PoC FR 1: supported = released within the last 3 months (owner decision 2026-11-13)", () => {
  it("NFR-07@PoC FR 1: each minimum is the oldest version released within 3 months of the check date", () => {
    const start = windowStart(SUPPORTED_BROWSERS.checkedOn);
    for (const browser of [SUPPORTED_BROWSERS.chromium, SUPPORTED_BROWSERS.safari]) {
      // The minimum was released inside the window, and the version before it was released before the window.
      expect(
        browser.released >= start,
        `${browser.version} released ${browser.released}, window from ${start}`,
      ).toBe(true);
      expect(browser.released <= SUPPORTED_BROWSERS.checkedOn).toBe(true);
      expect(
        browser.previous.released < start,
        `${browser.previous.version} released ${browser.previous.released}`,
      ).toBe(true);
    }
  });

  it(`NFR-07@PoC FR 1: the minimums were checked within the last ${MAX_CHECK_AGE_DAYS} days — refresh SUPPORTED_BROWSERS from the browsers' release dates when this fails`, () => {
    const today = new Date().toISOString().slice(0, 10);
    const ageDays =
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${SUPPORTED_BROWSERS.checkedOn}T00:00:00Z`)) /
      86_400_000;
    expect(ageDays, `checked on ${SUPPORTED_BROWSERS.checkedOn}, ${ageDays} days ago`).toBeLessThanOrEqual(
      MAX_CHECK_AGE_DAYS,
    );
    expect(ageDays).toBeGreaterThanOrEqual(0);
  });
});
