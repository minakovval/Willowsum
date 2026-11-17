import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, plain, problem, renderAt, resetAuthState, TOKEN, type Reply } from "./testing.tsx";

/**
 * S-007 «Відновлення пароля» (ACC-01@PoC FR 10, 11; canvas PocResetPassword, PocResetPasswordSent,
 * PocResetPasswordNew): where «Забули пароль?» and the letters of the reset and of «Це був не я» lead.
 */
const REQUESTED: Reply = { status: 200, body: { status: "requested" } };
const email = () => screen.getByRole("textbox", { name: /^Email/ }) as HTMLInputElement;
const newPassword = () => screen.getByLabelText(/^Новий пароль/, { selector: "input" }) as HTMLInputElement;

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(() => vi.useRealTimers());

describe("ACC-01@PoC S-007 password reset", () => {
  it("ACC-01@PoC FR 10: «Забули пароль?» on «Вхід» opens the request form", async () => {
    renderAt("#/login", fakeApi({}).client);
    fireEvent.click(screen.getByRole("link", { name: "Забули пароль?" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Відновлення пароля" })).toBeTruthy();
    expect(screen.getByText("Надішлемо одноразове посилання, дійсне 60 хвилин.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Повернутися до входу" }).getAttribute("href")).toBe("#/login");
  });

  it("ACC-01@PoC FR 10: the same answer for any address; «Надіслати ще раз» waits 60 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client, calls } = fakeApi({ "POST /v1/password-resets": REQUESTED });
    renderAt("#/password/reset", client);
    fireEvent.change(email(), { target: { value: " olena@example.com " } });
    fireEvent.click(screen.getByRole("button", { name: "Надіслати посилання" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Перевірте пошту" })).toBeTruthy();
    expect(plain(screen.getByRole("status").textContent)).toBe(
      "Якщо акаунт існує, ми надіслали лист на olena@example.com. Посилання діє 60 хвилин; новий запит скасовує попереднє посилання.",
    );
    expect(calls[0]).toMatchObject({ path: "/v1/password-resets", body: { email: "olena@example.com" } });
    const again = screen.getByRole("button", { name: /^Надіслати ще раз/ });
    expect(plain(again.textContent)).toBe("Надіслати ще раз · 1:00");
    expect(again.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await waitFor(() => expect(again.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(again);
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it("ACC-01@PoC FR 10: a malformed email gets its reason and sends nothing", () => {
    const { client, calls } = fakeApi({});
    renderAt("#/password/reset", client);
    fireEvent.change(email(), { target: { value: "olena" } });
    fireEvent.click(screen.getByRole("button", { name: "Надіслати посилання" }));
    expect(email().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/Введіть email у форматі/)).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("ACC-01@PoC FR 10, FR 11: the letter's link — a new password with «Показати пароль»; afterwards every session has ended", async () => {
    const { client, calls } = fakeApi({
      "POST /v1/password-resets/check": { status: 200, body: { status: "valid" } },
      "POST /v1/password-resets/complete": { status: 200, body: { status: "password-changed" } },
    });
    renderAt(`#/password/reset?token=${TOKEN}`, client);
    expect(screen.getByRole("status").textContent).toContain("Перевіряємо посилання");
    await screen.findByRole("heading", { level: 1, name: "Новий пароль" });
    expect(window.location.hash).toBe("#/password/reset");
    expect(screen.getByRole("button", { name: "Показати пароль" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(newPassword().getAttribute("autocomplete")).toBe("new-password");
    expect(screen.getByText("Після зміни пароля всі сесії буде завершено.")).toBeTruthy();

    fireEvent.change(newPassword(), { target: { value: "short" } });
    expect(screen.getByText(/Пароль має бути не коротшим за 12 символів/)).toBeTruthy();
    fireEvent.change(newPassword(), { target: { value: "a much longer pass phrase" } });
    expect(screen.getByText("Складність пароля: висока")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Зберегти пароль" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Пароль змінено" })).toBeTruthy();
    expect(screen.getByText("Усі сесії завершено. Увійдіть з новим паролем.")).toBeTruthy();
    expect(calls.at(-1)).toMatchObject({
      path: "/v1/password-resets/complete",
      body: { token: TOKEN, password: "a much longer pass phrase" },
    });
    expect(screen.getByRole("link", { name: "Увійти" }).getAttribute("href")).toBe("#/login");
  });

  it("ACC-01@PoC FR 10: a used, replaced or old link — «Посилання недійсне» and a way to ask for a new one", async () => {
    const { client } = fakeApi({ "POST /v1/password-resets/check": problem(410, "RESET_LINK_INVALID") });
    renderAt(`#/password/reset?token=${TOKEN}`, client);
    expect(await screen.findByRole("heading", { level: 1, name: "Посилання недійсне" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Попросити нове посилання" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Відновлення пароля");
  });

  it("ACC-01@PoC FR 10: a failed check shows «✕ Помилка» and «Спробувати ще раз»", async () => {
    let fail = true;
    const { client } = fakeApi({
      "POST /v1/password-resets/check": () => (fail ? "network" : { status: 200, body: { status: "valid" } }),
    });
    renderAt(`#/password/reset?token=${TOKEN}`, client);
    expect(plain((await screen.findByRole("alert")).textContent)).toContain("Помилка.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Новий пароль" })).toBeTruthy();
  });
});
