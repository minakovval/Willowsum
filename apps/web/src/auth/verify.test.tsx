import { fireEvent, screen, waitFor } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, plain, problem, renderAt, resetAuthState, SUPPORT_ID, TOKEN } from "./testing.tsx";

/** ACC-01@PoC: the confirmation link page and S-003 «Посилання недійсне» (canvas PocLinkInvalid): AC5, AC6, AC24. */
const link = `#/verify?token=${TOKEN}`;
const h1 = () => screen.getByRole("heading", { level: 1 }).textContent;
const confirmation = (result: string) => ({ status: 200, body: { result } });

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

describe("ACC-01@PoC confirmation link", () => {
  it("AC5: a valid link confirms the email once (also under StrictMode), creates no session and offers «Увійти»", async () => {
    const { client, calls } = fakeApi({ "POST /v1/email-confirmations": confirmation("confirmed") });
    renderAt(link, client, { strict: true });
    await waitFor(() => expect(h1()).toBe("Email підтверджено"));
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/v1/email-confirmations",
        origin: window.location.origin,
        body: { token: TOKEN },
      },
    ]);
    expect(screen.getByRole("link", { name: "Увійти" }).getAttribute("href")).toBe("#/login");
  });

  it("the token leaves the address bar once read (it is single use; the fragment never reaches a server)", async () => {
    const { client } = fakeApi({ "POST /v1/email-confirmations": confirmation("confirmed") });
    renderAt(link, client);
    await waitFor(() => expect(h1()).toBe("Email підтверджено"));
    expect(window.location.hash).toBe("#/verify");
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("while the link is checked: a polite progress line", () => {
    const { client } = fakeApi({ "POST /v1/email-confirmations": () => new Promise(() => undefined) });
    renderAt(link, client);
    expect(screen.getByRole("status").textContent).toBe("Перевіряємо посилання…");
  });

  it("AC6: a link older than 24 h opens «Посилання недійсне» with «Надіслати ще раз», which sends a new link", async () => {
    const { client, calls } = fakeApi({
      "POST /v1/email-confirmations": confirmation("expired"),
      "POST /v1/email-confirmations/resend": { status: 200, body: { status: "sent", resendAfterS: 60 } },
    });
    renderAt(link, client);
    await waitFor(() => expect(h1()).toBe("Посилання недійсне"));
    expect(screen.getByText(/прострочене або вже використане/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Надіслати ще раз" }));
    await waitFor(() => expect(screen.getByText(/Нове посилання надіслано/)).toBeTruthy());
    expect(calls.at(-1)).toEqual({
      method: "POST",
      path: "/v1/email-confirmations/resend",
      origin: window.location.origin,
      body: { token: TOKEN },
    });
    expect(screen.getByRole("button", { name: /^Надіслати ще раз · / }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(screen.getByRole("link", { name: "Повернутися до входу" }).getAttribute("href")).toBe("#/login");
  });

  it("AC6: a resend within the wait — the button counts down instead of an error", async () => {
    const { client } = fakeApi({
      "POST /v1/email-confirmations": confirmation("expired"),
      "POST /v1/email-confirmations/resend": problem(429, "RATE_LIMITED", { "retry-after": "42" }),
    });
    renderAt(link, client);
    fireEvent.click(await screen.findByRole("button", { name: "Надіслати ще раз" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Надіслати ще раз · 0:42" })).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("AC24: a used link without a session opens the sign-in page; nothing is confirmed again", async () => {
    const { client, calls } = fakeApi({
      "POST /v1/email-confirmations": confirmation("already-used"),
      "GET /v1/session": problem(401, "UNAUTHENTICATED"),
    });
    renderAt(link, client);
    await waitFor(() => expect(window.location.hash).toBe("#/login"));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /v1/email-confirmations",
      "GET /v1/session",
    ]);
  });

  it("AC24: a used link with an active session opens «Планування → Бюджет»", async () => {
    const { client } = fakeApi({
      "POST /v1/email-confirmations": confirmation("already-used"),
      "GET /v1/session": { status: 200, body: { name: "Олена", email: "olena@example.com" } },
    });
    renderAt(link, client);
    await waitFor(() => expect(window.location.hash).toBe("#/planning/budget"));
  });

  it("a malformed or unknown link: «Посилання недійсне» without resend, with the ways back", async () => {
    const { client, calls } = fakeApi({ "POST /v1/email-confirmations": confirmation("invalid") });
    renderAt("#/verify?token=short", client);
    expect(h1()).toBe("Посилання недійсне");
    expect(calls).toEqual([]);
    expect(screen.queryByRole("button", { name: /Надіслати ще раз/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Зареєструватися" }).getAttribute("href")).toBe("#/signup");
    expect(screen.getByRole("link", { name: "Повернутися до входу" }).getAttribute("href")).toBe("#/login");
  });

  it("a well-formed token the server does not know reads the same", async () => {
    const { client } = fakeApi({ "POST /v1/email-confirmations": confirmation("invalid") });
    renderAt(link, client);
    await waitFor(() => expect(screen.getByText(/Посилання для підтвердження неправильне/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Надіслати ще раз/ })).toBeNull();
  });

  it("a network error: the message and «Спробувати ще раз», which asks again", async () => {
    let first = true;
    const { client } = fakeApi({
      "POST /v1/email-confirmations": () => {
        if (first) {
          first = false;
          return "network";
        }
        return confirmation("confirmed");
      },
    });
    renderAt(link, client);
    expect(plain((await screen.findByRole("alert")).textContent)).toContain(
      "Не вдалося з’єднатися. Спробуйте ще раз",
    );
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    await waitFor(() => expect(h1()).toBe("Email підтверджено"));
  });

  it("the function hidden by its flag (404): a plain message with the code", async () => {
    const { client } = fakeApi({ "POST /v1/email-confirmations": problem(404, "NOT_FOUND") });
    renderAt(link, client);
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toContain("Реєстрація і вхід зараз недоступні. Спробуйте пізніше");
    expect(plain(alert.textContent)).toContain(`Код: ${SUPPORT_ID}`);
  });
});
