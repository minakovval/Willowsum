import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { SYNTHETIC_CAPTCHA_TOKEN } from "./captcha/config.ts";
import { fakeApi, plain, problem, renderAt, resetAuthState, SUPPORT_ID, TOKEN } from "./testing.tsx";

/** ACC-01@PoC S-001 «Реєстрація» (canvas PocSignUp): AC1–AC3, AC10, AC12, FR 3, FR 8, FR 12 and the UI states. */
const submit = () => screen.getByRole("button", { name: /Створити акаунт/ });
const field = (name: RegExp) => screen.getByLabelText(name, { selector: "input" });
const type = (name: RegExp, value: string) => fireEvent.change(field(name), { target: { value } });
const passCaptcha = () => fireEvent.click(screen.getByRole("checkbox", { name: "Я не робот" }));

function fillValid(password = "correcthorse") {
  type(/^Ім’я/, "Олена Коваль");
  type(/^Email/, "olena@example.com");
  type(/^Пароль/, password);
  passCaptcha();
}

const ok = {
  status: 200,
  body: { status: "check-email", registrationToken: TOKEN, resendAfterS: 60 },
};

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

describe("ACC-01@PoC S-001 sign-up", () => {
  it("AC2: an empty form keeps «Створити акаунт» inactive and says what to fix", () => {
    const { client, calls } = fakeApi({});
    renderAt("#/signup", client);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Створити акаунт");
    expect(submit().getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Щоб продовжити, виправте: Ім’я, Email, Пароль")).toBeTruthy();
    // The reason is tied to the button for screen readers.
    const summary = screen.getByText(/Щоб продовжити/);
    expect(submit().getAttribute("aria-describedby")).toBe(summary.id);
    // Pressing the inactive button shows every field's reason and sends nothing.
    fireEvent.click(submit());
    expect(screen.getByText("Введіть ім’я")).toBeTruthy();
    expect(screen.getByText("Введіть email")).toBeTruthy();
    expect(screen.getByText("Введіть пароль")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("AC2: a password shorter than 12 characters — the reason by the field, with «Помилка», and the button inactive", () => {
    const { client } = fakeApi({});
    renderAt("#/signup", client);
    type(/^Ім’я/, "Олена");
    type(/^Email/, "olena@example.com");
    type(/^Пароль/, "elevenchars");
    passCaptcha();
    const input = field(/^Пароль/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const error = document.getElementById(input.getAttribute("aria-describedby")!.split(" ")[0]!)!;
    expect(plain(error.textContent)).toBe("Помилка. Пароль має бути не коротшим за 12 символів");
    expect(submit().getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Щоб продовжити, виправте: Пароль")).toBeTruthy();
    // Characters are counted as code points: 11 letters and one emoji make 12.
    type(/^Пароль/, "elevenchars😀");
    expect(field(/^Пароль/).getAttribute("aria-invalid")).toBeNull();
    expect(submit().getAttribute("aria-disabled")).toBeNull();
  });

  it("AC2: a malformed email shows its reason after leaving the field", () => {
    const { client } = fakeApi({});
    renderAt("#/signup", client);
    type(/^Email/, "olena@");
    expect(screen.queryByText("Введіть email у форматі name@example.com")).toBeNull();
    fireEvent.blur(field(/^Email/));
    expect(screen.getByText("Введіть email у форматі name@example.com")).toBeTruthy();
    expect(field(/^Email/).getAttribute("aria-invalid")).toBe("true");
  });

  it("FR 12: without the CAPTCHA the button stays inactive and says so", () => {
    const { client } = fakeApi({});
    renderAt("#/signup", client);
    type(/^Ім’я/, "Олена");
    type(/^Email/, "olena@example.com");
    type(/^Пароль/, "correcthorse");
    expect(submit().getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Щоб продовжити, пройдіть перевірку CAPTCHA")).toBeTruthy();
    passCaptcha();
    expect(submit().getAttribute("aria-disabled")).toBeNull();
  });

  it("AC1, AC3, FR 8: 12 lower-case letters are accepted; one request to the app's own API, then «Перевірте пошту»", async () => {
    const { client, calls } = fakeApi({ "POST /v1/registrations": ok });
    renderAt("#/signup", client);
    fillValid("onlylowercase");
    expect(screen.getByText("Складність пароля: достатня")).toBeTruthy();
    fireEvent.click(submit());
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Перевірте пошту"),
    );
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/v1/registrations",
        origin: window.location.origin,
        body: {
          name: "Олена Коваль",
          email: "olena@example.com",
          password: "onlylowercase",
          captchaToken: SYNTHETIC_CAPTCHA_TOKEN,
        },
      },
    ]);
    expect(window.location.hash).toBe("#/signup/check-email");
    expect(screen.getByText("olena@example.com").tagName).toBe("B");
  });

  it("FR 3: the strength indicator follows length only, in words as well as bars", () => {
    const { client } = fakeApi({});
    renderAt("#/signup", client);
    expect(screen.queryByText(/Складність пароля/)).toBeNull();
    type(/^Пароль/, "short");
    expect(screen.getByText("Складність пароля: закороткий")).toBeTruthy();
    type(/^Пароль/, "twelve chars");
    expect(screen.getByText("Складність пароля: достатня")).toBeTruthy();
    type(/^Пароль/, "a much longer passphrase");
    expect(screen.getByText("Складність пароля: висока")).toBeTruthy();
    // No composition advice: the hint says digits and symbols are not required.
    type(/^Пароль/, "");
    expect(screen.getByText(/цифри і спецсимволи не обов’язкові/)).toBeTruthy();
  });

  it("AC10: only email and password — no Google or Apple, no consent boxes", () => {
    const { client } = fakeApi({});
    renderAt("#/signup", client);
    expect(screen.queryByText(/Google/)).toBeNull();
    expect(screen.queryByText(/Apple/)).toBeNull();
    const boxes = screen.queryAllByRole("checkbox");
    expect(boxes).toHaveLength(1);
    expect(within(screen.getByRole("group", { name: "Перевірка CAPTCHA" })).getByRole("checkbox")).toBe(
      boxes[0],
    );
    expect(screen.getByRole("link", { name: "Увійти" }).getAttribute("href")).toBe("#/login");
  });

  it("Loading: the button shows the spinner and is inactive until the answer; a second press sends nothing", async () => {
    let answer!: (r: typeof ok) => void;
    const { client, calls } = fakeApi({ "POST /v1/registrations": () => new Promise((r) => (answer = r)) });
    renderAt("#/signup", client);
    fillValid();
    fireEvent.click(submit());
    await waitFor(() => expect(submit().getAttribute("aria-busy")).toBe("true"));
    expect(submit().getAttribute("aria-disabled")).toBe("true");
    expect(submit().querySelector(".ws-spinner")).toBeTruthy();
    fireEvent.click(submit());
    expect(calls).toHaveLength(1);
    await act(async () => answer(ok));
    await waitFor(() => expect(window.location.hash).toBe("#/signup/check-email"));
  });

  it("Network error: «Не вдалося з’єднатися…»; name and email stay, the password does not", async () => {
    const { client } = fakeApi({ "POST /v1/registrations": "network" });
    renderAt("#/signup", client);
    fillValid();
    fireEvent.click(submit());
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toContain("Помилка. Не вдалося з’єднатися. Спробуйте ще раз");
    expect((field(/^Ім’я/) as HTMLInputElement).value).toBe("Олена Коваль");
    expect((field(/^Email/) as HTMLInputElement).value).toBe("olena@example.com");
    expect((field(/^Пароль/) as HTMLInputElement).value).toBe("");
    // The CAPTCHA token was used: the check has to be passed again.
    expect((screen.getByRole("checkbox", { name: "Я не робот" }) as HTMLInputElement).checked).toBe(false);
  });

  it("AC12: the sixth sign-up from an address — «Забагато спроб. Спробуйте пізніше» with the support code", async () => {
    const { client } = fakeApi({
      "POST /v1/registrations": problem(429, "RATE_LIMITED", { "retry-after": "1200" }),
    });
    renderAt("#/signup", client);
    fillValid();
    fireEvent.click(submit());
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toContain("Забагато спроб. Спробуйте пізніше");
    expect(plain(alert.textContent)).toContain(`Код: ${SUPPORT_ID}`);
    expect(window.location.hash).toBe("#/signup");
  });

  it("FR 12: a CAPTCHA the server did not accept asks to pass it again", async () => {
    const { client } = fakeApi({ "POST /v1/registrations": problem(400, "CAPTCHA_REQUIRED") });
    renderAt("#/signup", client);
    fillValid();
    fireEvent.click(submit());
    expect(plain((await screen.findByRole("alert")).textContent)).toContain(
      "Пройдіть перевірку CAPTCHA і спробуйте ще раз",
    );
  });

  it("Flag `identity.sign-in` off (404 as an unknown path) or the module off (503): a plain message, nothing breaks", async () => {
    for (const reply of [problem(404, "NOT_FOUND"), problem(503, "MODULE_UNAVAILABLE")]) {
      resetAuthState();
      const { client } = fakeApi({ "POST /v1/registrations": reply });
      const view = renderAt("#/signup", client);
      fillValid();
      fireEvent.click(submit());
      const alert = await screen.findByRole("alert");
      expect(plain(alert.textContent)).toContain("Реєстрація і вхід зараз недоступні. Спробуйте пізніше");
      expect(plain(alert.textContent)).toContain(`Код: ${SUPPORT_ID}`);
      view.unmount();
    }
  });

  it("Accessibility: labelled fields with the required mark in words, autocomplete for a new account", () => {
    const { client } = fakeApi({});
    renderAt("#/signup", client);
    // The «*» is hidden from screen readers; the name says «обов’язкове поле» in words.
    expect(screen.getByRole("textbox", { name: "Ім’я, обов’язкове поле" }).getAttribute("autocomplete")).toBe(
      "name",
    );
    expect(
      screen.getByRole("textbox", { name: "Email, обов’язкове поле" }).getAttribute("autocomplete"),
    ).toBe("email");
    expect(field(/^Пароль/).getAttribute("autocomplete")).toBe("new-password");
    for (const input of screen.getAllByRole("textbox"))
      expect(input.getAttribute("aria-required")).toBe("true");
    expect(document.title).toBe("Willowsum · Реєстрація");
    // Focus mode: no app navigation around the card (GRID-06 FR 5).
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
