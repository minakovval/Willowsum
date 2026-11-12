import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import viteConfig from "../../vite.config.ts";
import { App } from "../App.tsx";
import { AuthApiProvider, createAuthClient } from "./api.ts";
import { currentRegistration, signUpDraft, leaveRegistration } from "./registration.ts";
import { fakeApi, renderAt, resetAuthState, TOKEN } from "./testing.tsx";

/**
 * Security review of PR #93 (ACC-01@PoC part a2): the guards of the sign-up and confirmation screens —
 * the link token read from the fragment and dropped from the address bar and history, the token only in a
 * same-origin POST body, the password never kept, the CAPTCHA token single use, no server text rendered,
 * and the dev/preview `/v1` proxy never reaching a build.
 */

const TYPED = "willowwillowwillow";
const OTHER = "B".repeat(43);
const h1 = () => screen.getByRole("heading", { level: 1 }).textContent;
const field = (name: RegExp) => screen.getByLabelText(name, { selector: "input" });
const type = (name: RegExp, value: string) => fireEvent.change(field(name), { target: { value } });
const passCaptcha = () => fireEvent.click(screen.getByRole("checkbox", { name: "Я не робот" }));
const submit = () => screen.getByRole("button", { name: /Створити акаунт/ });

function fillValid() {
  type(/^Ім’я/, "Олена Коваль");
  type(/^Email/, "olena@example.com");
  type(/^Пароль/, TYPED);
  passCaptcha();
}

/** Every stored byte this origin can keep. */
const stored = () =>
  [localStorage, sessionStorage]
    .flatMap((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k) ?? ""}`))
    .join("\n") + document.cookie;

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

describe("sec93: the confirmation link token", () => {
  it("is dropped by replacing the history entry, not by adding one (Back must not bring it back)", async () => {
    const { client } = fakeApi({
      "POST /v1/email-confirmations": { status: 200, body: { result: "confirmed" } },
    });
    // The link opens: one history entry with the token. The page must replace it, not push a clean one after it.
    window.location.hash = `#/verify?token=${TOKEN}`;
    const entries = window.history.length;
    render(
      <AuthApiProvider value={client}>
        <App />
      </AuthApiProvider>,
    );
    await waitFor(() => expect(h1()).toBe("Email підтверджено"));
    expect(window.history.length).toBe(entries);
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("leaves the address bar also when it is malformed, and when the request fails", async () => {
    const { client } = fakeApi({ "POST /v1/email-confirmations": "network" });
    renderAt("#/verify?token=short-but-secret", client);
    expect(window.location.href).not.toContain("short-but-secret");
    renderAt(`#/verify?token=${TOKEN}`, client);
    await screen.findAllByRole("alert");
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("goes only in the body of a POST to the app's own origin — never in a URL", async () => {
    const urls: string[] = [];
    const methods: string[] = [];
    const client = createAuthClient((async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      urls.push(request.url);
      methods.push(request.method);
      return new Response(JSON.stringify({ result: "confirmed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch);
    renderAt(`#/verify?token=${TOKEN}`, client);
    await waitFor(() => expect(h1()).toBe("Email підтверджено"));
    expect(methods).toEqual(["POST"]);
    expect(urls).toEqual([`${window.location.origin}/v1/email-confirmations`]);
  });

  it("a second link opened while the verify page is shown is read and dropped too (not left in the address bar)", async () => {
    const { client, calls } = fakeApi({
      "POST /v1/email-confirmations": { status: 200, body: { result: "confirmed" } },
    });
    renderAt(`#/verify?token=${TOKEN}`, client);
    await waitFor(() => expect(h1()).toBe("Email підтверджено"));
    await act(async () => {
      window.location.hash = `#/verify?token=${OTHER}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(calls.map((c) => c.body)).toContainEqual({ token: OTHER }));
    expect(window.location.href).not.toContain(OTHER);
  });
});

describe("sec93: the password and the CAPTCHA token", () => {
  it("the password is kept nowhere: not in storage, not in the sign-up in memory, not in the draft", async () => {
    const { client, calls } = fakeApi({
      "POST /v1/registrations": {
        status: 200,
        body: { status: "check-email", registrationToken: TOKEN, resendAfterS: 60 },
      },
    });
    renderAt("#/signup", client);
    fillValid();
    fireEvent.click(submit());
    await waitFor(() => expect(window.location.hash).toBe("#/signup/check-email"));
    expect(calls).toHaveLength(1);
    expect(stored()).not.toContain(TYPED);
    expect(JSON.stringify(currentRegistration())).not.toContain(TYPED);
    leaveRegistration();
    expect(JSON.stringify(signUpDraft())).not.toContain(TYPED);
    expect(stored()).not.toContain(TYPED);
  });

  it("a CAPTCHA token is sent once: after an answer the next request waits for a new check", async () => {
    const { client, calls } = fakeApi({ "POST /v1/registrations": "network" });
    renderAt("#/signup", client);
    fillValid();
    fireEvent.click(submit());
    await screen.findByRole("alert");
    type(/^Пароль/, TYPED);
    fireEvent.click(submit());
    await act(async () => undefined);
    expect(calls).toHaveLength(1);
    expect(submit().getAttribute("aria-disabled")).toBe("true");
  });
});

describe("sec93: no server or link text is rendered", () => {
  it("a problem's title and detail are never shown; a supportId that is not 32 hex digits is not shown", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const { client } = fakeApi({
      "POST /v1/registrations": {
        status: 500,
        body: {
          type: "about:blank",
          title: hostile,
          detail: hostile,
          status: 500,
          code: "INTERNAL",
          supportId: hostile,
        },
        headers: { "content-type": "application/problem+json" },
      },
    });
    renderAt("#/signup", client);
    fillValid();
    fireEvent.click(submit());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("onerror");
    expect(alert.textContent).not.toContain("Код");
    expect(document.querySelector("img")).toBeNull();
  });

  it("the token of a link is never put on the page", async () => {
    const markup = "%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E";
    const { client } = fakeApi({});
    renderAt(`#/verify?token=${markup}`, client);
    expect(h1()).toBe("Посилання недійсне");
    expect(document.body.innerHTML).not.toContain("onerror");
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("sec93: the `/v1` proxy stays in the dev and preview servers", () => {
  it("only server/preview carry it; nothing of WS_API_ORIGIN is defined into the bundle or exposed by env prefix", () => {
    const config = viteConfig as Record<string, unknown> & {
      server?: { proxy?: Record<string, unknown> };
      preview?: { proxy?: Record<string, unknown> };
    };
    expect(Object.keys(config.server?.proxy ?? {})).toEqual(["/v1"]);
    expect(Object.keys(config.preview?.proxy ?? {})).toEqual(["/v1"]);
    expect(config["define"]).toBeUndefined();
    expect(config["envPrefix"]).toBeUndefined();
    expect(JSON.stringify(config["build"])).not.toContain("proxy");
  });
});
