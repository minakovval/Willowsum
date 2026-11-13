import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, renderAt, resetAuthState } from "../auth/testing.tsx";
import { UnsupportedBrowserNotice } from "./UnsupportedBrowserNotice.tsx";

/** NFR-07@PoC EC1: the notice in an unsupported browser — the supported browsers named, sign-in not blocked. */
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0";
const realUserAgent = navigator.userAgent;
const setUserAgent = (ua: string) =>
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(() => setUserAgent(realUserAgent));

describe("NFR-07@PoC EC1: unsupported-browser notice", () => {
  it("NFR-07@PoC EC1: lists the supported browsers as a polite warning with its word", () => {
    render(
      <I18nProvider initialLocale="uk">
        <UnsupportedBrowserNotice support="unsupported" />
      </I18nProvider>,
    );
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Цей браузер не підтримується.");
    expect(notice.textContent).toContain("Chrome, Edge і Safari");
    expect(notice.querySelector("svg")).toBeTruthy();
  });

  it("NFR-07@PoC EC1: in English too", () => {
    render(
      <I18nProvider initialLocale="en">
        <UnsupportedBrowserNotice support="unsupported" />
      </I18nProvider>,
    );
    expect(screen.getByRole("status").textContent).toContain("Chrome, Edge and Safari");
  });

  it("NFR-07@PoC EC1: nothing in a supported browser", () => {
    const { container } = render(
      <I18nProvider initialLocale="uk">
        <UnsupportedBrowserNotice support="supported" />
      </I18nProvider>,
    );
    expect(container.textContent).toBe("");
  });

  it("NFR-07@PoC EC1: on «Вхід» in Firefox the notice is shown and signing in still works", async () => {
    setUserAgent(FIREFOX);
    const { client, calls } = fakeApi({
      "POST /v1/sessions": { status: 200, body: { status: "signed-in" } },
    });
    renderAt("#/login", client);
    expect(screen.getByText(/Цей браузер не підтримується/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: /^Email/ }), {
      target: { value: "olena@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Пароль/, { selector: "input" }), {
      target: { value: "correcthorsebattery" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Увійти/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/planning/budget"));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain("POST /v1/sessions");
  });
});
