import { browserSupport, SUPPORTED_BROWSERS } from "./support.ts";

/** NFR-07@PoC EC1: which browsers the PoC supports (FR 1: the last two versions of Chrome, Safari and Edge). */
const chrome = (v: string) =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
const edge = (v: string) => `${chrome(v)} Edg/${v}`;
const safari = (v: string) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v} Safari/605.1.15`;
const firefox = (v: string) =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${v}) Gecko/20100101 Firefox/${v}`;

const minChromium = SUPPORTED_BROWSERS.chromium;
const minSafari = SUPPORTED_BROWSERS.safari;

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
