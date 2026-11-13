import {
  BROWSER_RELEASES,
  browserSupport,
  RELEASE_TABLE_STALE_AFTER_DAYS,
  supportCutoff,
  supportedMinimums,
  type Release,
} from "./support.ts";

/**
 * NFR-07@PoC FR 1, EC1: supported = Chrome, Safari and Edge versions released in the last 3 months (owner decision
 * 2026-11-13). The cutoff moves with the date; the release tables say when each version came out. Every case fixes
 * its date once (no re-reading of the clock inside a test).
 */
const chrome = (v: string) =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
const edge = (v: string) => `${chrome(v)} Edg/${v}`;
const safari = (v: string) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v} Safari/605.1.15`;
const firefox = (v: string) =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${v}) Gecko/20100101 Firefox/${v}`;
const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** The date the tables were checked against the browsers' release pages. */
const CHECKED = day("2026-11-13");

describe("NFR-07@PoC EC1: browser support detection (on 2026-11-13: Chromium from 153, Safari from 27.0)", () => {
  it("NFR-07@PoC EC1: Chrome and Edge from the oldest supported version are supported", () => {
    expect(browserSupport(chrome("153.0.0.0"), CHECKED)).toBe("supported");
    expect(browserSupport(chrome("158.0.8103.12"), CHECKED)).toBe("supported");
    expect(browserSupport(edge("153.0.0.0"), CHECKED)).toBe("supported");
  });

  it("NFR-07@PoC EC1: other Chromium-based browsers count by their Chromium version", () => {
    expect(browserSupport(`${chrome("153.0.0.0")} OPR/138.0.0.0`, CHECKED)).toBe("supported");
  });

  it("NFR-07@PoC EC1: Safari from the oldest supported version is supported", () => {
    expect(browserSupport(safari("27.0"), CHECKED)).toBe("supported");
    expect(browserSupport(safari("27.2"), CHECKED)).toBe("supported");
    expect(browserSupport(safari("28.0"), CHECKED)).toBe("supported");
  });

  it("NFR-07@PoC EC1: older Chrome, Edge and Safari are unsupported", () => {
    expect(browserSupport(chrome("152.0.0.0"), CHECKED)).toBe("unsupported");
    expect(browserSupport(edge("152.0.0.0"), CHECKED)).toBe("unsupported");
    expect(browserSupport(safari("26.6"), CHECKED)).toBe("unsupported");
  });

  it("NFR-07@PoC EC1: Firefox is unsupported in PoC (it joins in PoC v2)", () => {
    expect(browserSupport(firefox("155.0"), CHECKED)).toBe("unsupported");
    expect(browserSupport(`${safari("27.0")} FxiOS/150.0`, CHECKED)).toBe("unsupported");
  });

  it("NFR-07@PoC EC1: an unknown or empty user agent is unsupported", () => {
    expect(browserSupport("", CHECKED)).toBe("unsupported");
    expect(
      browserSupport("Mozilla/5.0 (linux) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/29.1.1", CHECKED),
    ).toBe("unsupported");
    expect(browserSupport("curl/8.0", CHECKED)).toBe("unsupported");
  });
});

describe("NFR-07@PoC FR 1: supported = released within the last 3 months (owner decision 2026-11-13)", () => {
  it("NFR-07@PoC FR 1: the cutoff is the date 3 calendar months back (UTC)", () => {
    expect(supportCutoff(CHECKED)).toBe("2026-08-13");
    expect(supportCutoff(day("2027-01-05"))).toBe("2026-10-05");
  });

  it("NFR-07@PoC FR 1: the minimum is the oldest version released on or after the cutoff", () => {
    // 152 came out on 2026-08-12, one day before the window; 153 on 2026-08-26. Safari 26.6 on 2026-07-27, 27.0 on 2026-09-14.
    expect(supportedMinimums(CHECKED)).toEqual({ chromium: "153", safari: "27.0" });
    // The day 153 is exactly 3 months old it is still in; the next day it is out.
    expect(supportedMinimums(day("2026-11-26")).chromium).toBe("153");
    expect(supportedMinimums(day("2026-11-27")).chromium).toBe("154");
    // Safari 27.0 leaves the window after 2026-12-14; 27.1 (2026-10-23) is the next.
    expect(supportedMinimums(day("2026-12-15")).safari).toBe("27.1");
  });

  it("NFR-07@PoC FR 1: the minimum moves with the date, so detection does too", () => {
    expect(browserSupport(chrome("153.0.0.0"), day("2026-11-26"))).toBe("supported");
    expect(browserSupport(chrome("153.0.0.0"), day("2026-11-27"))).toBe("unsupported");
    expect(browserSupport(safari("27.0"), day("2026-12-15"))).toBe("unsupported");
    expect(browserSupport(safari("27.1"), day("2026-12-15"))).toBe("supported");
  });

  it("NFR-07@PoC FR 1: with no release in the window, the newest known release is the minimum", () => {
    expect(supportedMinimums(day("2027-06-01"))).toEqual({
      chromium: BROWSER_RELEASES.chromium.at(-1)!.version,
      safari: BROWSER_RELEASES.safari.at(-1)!.version,
    });
  });

  it("NFR-07@PoC FR 1: the release tables are ordered by version and by date, Chromium majors without gaps", () => {
    for (const [name, table] of Object.entries(BROWSER_RELEASES) as [string, readonly Release[]][]) {
      for (let i = 1; i < table.length; i++) {
        const [a, b] = [table[i - 1]!, table[i]!];
        expect(b.released > a.released, `${name} ${b.version} after ${a.version}`).toBe(true);
        expect(
          Number(b.version.split(".")[0]) * 1000 + Number(b.version.split(".")[1] ?? 0) >
            Number(a.version.split(".")[0]) * 1000 + Number(a.version.split(".")[1] ?? 0),
        ).toBe(true);
        if (name === "chromium") expect(Number(b.version)).toBe(Number(a.version) + 1);
      }
    }
  });
});

describe("NFR-07@PoC FR 1: release tables kept current", () => {
  // Read once: this check is about today, the others fix their dates.
  const today = new Date();

  for (const [name, table] of Object.entries(BROWSER_RELEASES) as [string, readonly Release[]][]) {
    const limit = RELEASE_TABLE_STALE_AFTER_DAYS[name as keyof typeof BROWSER_RELEASES];
    it(`NFR-07@PoC FR 1: the ${name} release table has a release from the last ${limit} days`, () => {
      const newest = table.at(-1)!;
      const ageDays = Math.floor((today.getTime() - Date.parse(`${newest.released}T00:00:00Z`)) / 86_400_000);
      expect(
        ageDays,
        `The ${name} release table is stale: its newest release (${newest.version}, ${newest.released}) is ${ageDays} days old. ` +
          `Add the newer releases with their first stable dates to BROWSER_RELEASES in apps/web/src/browser/support.ts.`,
      ).toBeLessThanOrEqual(limit);
    });
  }
});
