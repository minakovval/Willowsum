import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { SYNTHETIC_CAPTCHA_TOKEN } from "./captcha/config.ts";
import { fakeApi, plain, problem, renderAt, resetAuthState, SUPPORT_ID, TOKEN } from "./testing.tsx";

/** ACC-01@PoC S-004 «Вхід» (canvas PocSignIn, PocSignInLocked, PocSignInUnconfirmed): AC7, AC13–AC15, FR 5, FR 12. */
const signInButton = () => screen.getByRole("button", { name: /^Увійти/ });
const password = () => screen.getByLabelText(/^Пароль/, { selector: "input" }) as HTMLInputElement;
const email = () => screen.getByRole("textbox", { name: /^Email/ }) as HTMLInputElement;
const captchaBox = () => screen.queryByRole("checkbox", { name: "Я не робот" });

function fill(address = "olena@example.com", secret = "correct horse battery") {
  fireEvent.change(email(), { target: { value: address } });
  fireEvent.change(password(), { target: { value: secret } });
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(() => vi.useRealTimers());

describe("ACC-01@PoC S-004 sign-in", () => {
  it("AC10, AC15: only email and password — no Google, Apple or sign-in link; no CAPTCHA before a lockout", () => {
    renderAt("#/login", fakeApi({}).client);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Вхід");
    expect(screen.queryByText(/Google/)).toBeNull();
    expect(screen.queryByText(/Apple/)).toBeNull();
    expect(screen.queryByText(/за посиланням/)).toBeNull();
    expect(captchaBox()).toBeNull();
    expect(password().getAttribute("autocomplete")).toBe("current-password");
    expect(email().getAttribute("autocomplete")).toBe("username");
    expect(screen.getByRole("link", { name: "Створити акаунт" }).getAttribute("href")).toBe("#/signup");
    expect(document.title).toBe("Willowsum · Вхід");
  });

  it("the button is inactive until both fields are filled", () => {
    renderAt("#/login", fakeApi({}).client);
    expect(signInButton().getAttribute("aria-disabled")).toBe("true");
    fill();
    expect(signInButton().getAttribute("aria-disabled")).toBeNull();
  });

  it("signed in: «Планування → Бюджет» opens; the request carried no CAPTCHA", async () => {
    const { client, calls } = fakeApi({
      "POST /v1/sessions": { status: 200, body: { status: "signed-in" } },
    });
    renderAt("#/login", client);
    fill();
    fireEvent.click(signInButton());
    await waitFor(() => expect(window.location.hash).toBe("#/planning/budget"));
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/v1/sessions",
        origin: window.location.origin,
        body: { email: "olena@example.com", password: "correct horse battery" },
      },
    ]);
  });

  it("AC13: a wrong email or password — the one message «Невірний email або пароль»; the email stays", async () => {
    const { client } = fakeApi({ "POST /v1/sessions": problem(401, "INVALID_CREDENTIALS") });
    renderAt("#/login", client);
    fill();
    fireEvent.click(signInButton());
    const alert = await screen.findByRole("alert");
    expect(alert.querySelector(".auth-notice-text")!.firstChild!.textContent).toBe("Помилка. ");
    expect(plain(alert.textContent)).toContain("Невірний email або пароль");
    expect(alert.querySelector(".auth-notice-code")!.textContent).toBe(`Код: ${SUPPORT_ID}`);
    expect(email().value).toBe("olena@example.com");
    expect(password().value).toBe("");
  });

  it("AC14: the lockout — the message, «Увійти · 15:00» counting down, then the CAPTCHA on every attempt", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const replies = [
      problem(429, "SIGN_IN_LOCKED", { "retry-after": "900" }),
      { status: 200, body: { status: "signed-in" } },
    ];
    const { client, calls } = fakeApi({ "POST /v1/sessions": () => replies.shift()! });
    renderAt("#/login", client);
    fill();
    fireEvent.click(signInButton());
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toBe(
      "Помилка. Вхід тимчасово заблоковано. Забагато невдалих спроб. Спробуйте через 15 хв — далі кожна спроба потребуватиме перевірки CAPTCHA.",
    );
    expect(signInButton().textContent).toBe("Увійти · 15:00");
    expect(signInButton().getAttribute("aria-disabled")).toBe("true");
    expect(captchaBox()).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(28_000);
    });
    expect(signInButton().textContent).toBe("Увійти · 14:32");
    fireEvent.change(password(), { target: { value: "correct horse battery" } });
    fireEvent.click(captchaBox()!);
    expect(signInButton().getAttribute("aria-disabled")).toBe("true");
    act(() => {
      vi.advanceTimersByTime(872_000);
    });
    expect(signInButton().textContent).toBe("Увійти");
    expect(screen.getByText("Для входу пройдіть перевірку CAPTCHA.").closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByText("Вхід тимчасово заблоковано.")).toBeNull();
    expect(signInButton().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(signInButton());
    await waitFor(() => expect(window.location.hash).toBe("#/planning/budget"));
    expect(calls[1]!.body).toEqual({
      email: "olena@example.com",
      password: "correct horse battery",
      captchaToken: SYNTHETIC_CAPTCHA_TOKEN,
    });
  });

  it("AC14: after a lockout (CAPTCHA_REQUIRED) the CAPTCHA appears and the button waits for it", async () => {
    const replies = [problem(400, "CAPTCHA_REQUIRED"), problem(401, "INVALID_CREDENTIALS")];
    const { client, calls } = fakeApi({ "POST /v1/sessions": () => replies.shift()! });
    renderAt("#/login", client);
    fill();
    fireEvent.click(signInButton());
    await waitFor(() => expect(captchaBox()).toBeTruthy());
    expect(screen.getByText("Для входу пройдіть перевірку CAPTCHA.")).toBeTruthy();
    expect(signInButton().getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Щоб продовжити, пройдіть перевірку CAPTCHA")).toBeTruthy();
    fireEvent.click(captchaBox()!);
    fireEvent.click(signInButton());
    expect(plain((await screen.findByRole("alert")).textContent)).toContain("Невірний email або пароль");
    expect(calls[1]!.body).toMatchObject({ captchaToken: SYNTHETIC_CAPTCHA_TOKEN });
    // The token was used: the check has to be passed again.
    expect((captchaBox() as HTMLInputElement).checked).toBe(false);
  });

  it("AC7, FR 5: an unconfirmed account — «Спершу підтвердіть email» and «Надіслати лист ще раз», no session", async () => {
    const { client, calls } = fakeApi({
      "POST /v1/sessions": {
        status: 200,
        body: { status: "email-not-confirmed", registrationToken: TOKEN, resendAfterS: 0 },
      },
      "POST /v1/registrations/resend": { status: 200, body: { status: "sent", resendAfterS: 60 } },
    });
    renderAt("#/login", client);
    fill();
    fireEvent.click(signInButton());
    const notice = await screen.findByText("Спершу підтвердіть email.");
    expect(plain(notice.parentElement!.textContent)).toBe(
      "Спершу підтвердіть email. Ми надіслали посилання на olena@example.com. Без підтвердження увійти не можна.",
    );
    expect(window.location.hash).toBe("#/login");
    fireEvent.click(screen.getByRole("button", { name: "Надіслати лист ще раз" }));
    await waitFor(() =>
      expect(screen.getByText("Лист надіслано. Попередні посилання більше не діють.")).toBeTruthy(),
    );
    expect(calls.at(-1)).toEqual({
      method: "POST",
      path: "/v1/registrations/resend",
      origin: window.location.origin,
      body: { registrationToken: TOKEN },
    });
    expect(
      screen.getByRole("button", { name: "Надіслати лист ще раз · 1:00" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("Loading: «Увійти» shows the spinner and is inactive until the answer", async () => {
    let answer!: (r: unknown) => void;
    const { client, calls } = fakeApi({
      "POST /v1/sessions": () => new Promise((r) => (answer = r)) as never,
    });
    renderAt("#/login", client);
    fill();
    fireEvent.click(signInButton());
    await waitFor(() => expect(signInButton().getAttribute("aria-busy")).toBe("true"));
    expect(signInButton().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(signInButton());
    expect(calls).toHaveLength(1);
    await act(async () => answer({ status: 200, body: { status: "signed-in" } }));
  });

  it("AC19: after sending, the password field is hidden again", async () => {
    const { client } = fakeApi({ "POST /v1/sessions": problem(401, "INVALID_CREDENTIALS") });
    renderAt("#/login", client);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Показати пароль" }));
    expect(password().type).toBe("text");
    fireEvent.click(signInButton());
    expect(password().type).toBe("password");
  });

  it("Network error and the hidden function (404): plain messages; the email stays", async () => {
    for (const [reply, text] of [
      ["network", "Не вдалося з’єднатися. Спробуйте ще раз"],
      [problem(404, "NOT_FOUND"), "Реєстрація і вхід зараз недоступні. Спробуйте пізніше"],
      [problem(429, "RATE_LIMITED", { "retry-after": "30" }), "Забагато спроб. Спробуйте пізніше"],
    ] as const) {
      const { client } = fakeApi({ "POST /v1/sessions": reply });
      const view = renderAt("#/login", client);
      fill();
      fireEvent.click(signInButton());
      expect(plain((await screen.findByRole("alert")).textContent)).toContain(text);
      expect(email().value).toBe("olena@example.com");
      view.unmount();
    }
  });
});

describe("ACC-01@PoC S-004 sign-in: review of #95 (security follow-ups 1 and 2)", () => {
  it("AC14: a CAPTCHA token is sent once — after each attempt the next one waits for a new check", async () => {
    const replies = [
      problem(400, "CAPTCHA_REQUIRED"),
      problem(401, "INVALID_CREDENTIALS"),
      problem(401, "INVALID_CREDENTIALS"),
    ];
    const { client, calls } = fakeApi({ "POST /v1/sessions": () => replies.shift()! });
    renderAt("#/login", client);
    fill();
    fireEvent.click(signInButton());
    await waitFor(() => expect(captchaBox()).toBeTruthy());
    fireEvent.click(captchaBox()!);
    fireEvent.click(signInButton());
    await screen.findByRole("alert");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toMatchObject({ captchaToken: SYNTHETIC_CAPTCHA_TOKEN });
    // The used token is gone: with the password typed again, «Увійти» still waits for the check.
    fireEvent.change(password(), { target: { value: "correct horse battery" } });
    expect(signInButton().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(signInButton());
    await act(async () => undefined);
    expect(calls).toHaveLength(2);
    fireEvent.click(captchaBox()!);
    fireEvent.click(signInButton());
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]!.body).toMatchObject({ captchaToken: SYNTHETIC_CAPTCHA_TOKEN });
  });

  it("AC7, FR 5: on «Спершу підтвердіть email» the typed password is cleared; the email stays", async () => {
    const { client } = fakeApi({
      "POST /v1/sessions": {
        status: 200,
        body: { status: "email-not-confirmed", registrationToken: TOKEN, resendAfterS: 0 },
      },
    });
    renderAt("#/login", client);
    fill();
    fireEvent.click(signInButton());
    await screen.findByText("Спершу підтвердіть email.");
    expect(password().value).toBe("");
    expect(email().value).toBe("olena@example.com");
  });
});
