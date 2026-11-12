import { act, fireEvent, render, screen } from "@testing-library/react";
import { WEB_CSP_DIRECTIVES } from "../../../security-headers.ts";
import { Captcha } from "./Captcha.tsx";
import { captchaConfig, SYNTHETIC_CAPTCHA_TOKEN } from "./config.ts";
import {
  loadTurnstile,
  resetTurnstileLoader,
  TURNSTILE_SCRIPT,
  type TurnstileRenderOptions,
} from "./turnstile.ts";

/** ACC-01@PoC FR 12: the CAPTCHA behind an adapter — Cloudflare Turnstile with a site key, else the synthetic widget. */
const SITE_KEY = ["0x4", "test", "site", "key"].join("-"); // a public identifier, built at run time

afterEach(() => {
  delete window.turnstile;
  resetTurnstileLoader();
  document.head.querySelectorAll("script").forEach((s) => s.remove());
});

describe("CAPTCHA configuration", () => {
  it("the site key comes from VITE_CAPTCHA_SITE_KEY; without one (local, CI) the synthetic widget", () => {
    expect(captchaConfig({})).toEqual({ mode: "synthetic" });
    expect(captchaConfig({ VITE_CAPTCHA_SITE_KEY: "" })).toEqual({ mode: "synthetic" });
    expect(captchaConfig({ VITE_CAPTCHA_SITE_KEY: "not a key <script>" })).toEqual({ mode: "synthetic" });
    expect(captchaConfig({ VITE_CAPTCHA_SITE_KEY: ` ${SITE_KEY} ` })).toEqual({
      mode: "turnstile",
      siteKey: SITE_KEY,
    });
    // The test build has no key.
    expect(captchaConfig()).toEqual({ mode: "synthetic" });
  });

  it("the synthetic token is the one the API's synthetic verifier accepts", async () => {
    const { SYNTHETIC_CAPTCHA_PASS } =
      await import("../../../../api/src/platform/adapters/captcha/synthetic.ts");
    expect(SYNTHETIC_CAPTCHA_TOKEN).toBe(SYNTHETIC_CAPTCHA_PASS);
  });
});

describe("synthetic widget", () => {
  it("gives the token when checked, none when unchecked, and clears on reset", () => {
    const onToken = vi.fn();
    const view = render(
      <Captcha onToken={onToken} resetSignal={0} action="sign-up" config={{ mode: "synthetic" }} />,
    );
    expect(screen.getByRole("group", { name: "Перевірка CAPTCHA" })).toBeTruthy();
    const box = screen.getByRole("checkbox", { name: "Я не робот" }) as HTMLInputElement;
    fireEvent.click(box);
    expect(onToken).toHaveBeenLastCalledWith(SYNTHETIC_CAPTCHA_TOKEN);
    fireEvent.click(box);
    expect(onToken).toHaveBeenLastCalledWith(null);
    fireEvent.click(box);
    view.rerender(
      <Captcha onToken={onToken} resetSignal={1} action="sign-up" config={{ mode: "synthetic" }} />,
    );
    expect(box.checked).toBe(false);
  });
});

describe("Cloudflare Turnstile adapter", () => {
  it("loads the provider's script from the one CAPTCHA origin the CSP allows — no inline script", () => {
    void loadTurnstile();
    const scripts = [...document.head.querySelectorAll("script")];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.src).toBe(TURNSTILE_SCRIPT);
    expect(scripts[0]!.textContent).toBe("");
    const origin = new URL(TURNSTILE_SCRIPT).origin;
    expect(WEB_CSP_DIRECTIVES["script-src"]).toContain(origin);
    expect(WEB_CSP_DIRECTIVES["frame-src"]).toContain(origin);
    // Loaded once per page.
    void loadTurnstile();
    expect(document.head.querySelectorAll("script")).toHaveLength(1);
  });

  it("renders the widget with the site key and action, passes its token on and resets it after use", async () => {
    let options: TurnstileRenderOptions | undefined;
    const api = {
      render: vi.fn((_el: HTMLElement, o: TurnstileRenderOptions) => {
        options = o;
        return "w1";
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    window.turnstile = api;
    const onToken = vi.fn();
    const config = { mode: "turnstile", siteKey: SITE_KEY } as const;
    const view = render(<Captcha onToken={onToken} resetSignal={0} action="sign-in" config={config} />);
    await act(async () => undefined);
    expect(api.render).toHaveBeenCalledTimes(1);
    expect(options).toMatchObject({ sitekey: SITE_KEY, action: "sign-in", language: "uk" });
    act(() => options!.callback("provider-token"));
    expect(onToken).toHaveBeenLastCalledWith("provider-token");
    act(() => options!["expired-callback"]());
    expect(onToken).toHaveBeenLastCalledWith(null);
    view.rerender(<Captcha onToken={onToken} resetSignal={1} action="sign-in" config={config} />);
    expect(api.reset).toHaveBeenCalledWith("w1");
    view.unmount();
    expect(api.remove).toHaveBeenCalledWith("w1");
  });

  it("a script that fails to load shows an error instead of an empty box", async () => {
    render(
      <Captcha
        onToken={() => undefined}
        resetSignal={0}
        action="sign-up"
        config={{ mode: "turnstile", siteKey: SITE_KEY }}
      />,
    );
    const script = document.head.querySelector("script")!;
    await act(async () => {
      script.dispatchEvent(new Event("error"));
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Не вдалося завантажити перевірку CAPTCHA",
    );
  });
});
