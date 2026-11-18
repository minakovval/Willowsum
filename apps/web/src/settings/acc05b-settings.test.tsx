import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import {
  fakeApi,
  plain,
  problem,
  renderAt,
  resetAuthState,
  SUPPORT_ID,
  TOKEN,
  type Call,
  type Reply,
} from "../auth/testing.tsx";

/**
 * ACC-05@PoC b) and GRID-05@PoC (wave 2, row 110): «Налаштування» (S-186), «Профіль» (S-187) and the step-up
 * dialog (S-032) on the profile API of ACC-05 a). Boards PocSettings, PocProfilePassword, PocStepUp. Synthetic data.
 */
const PROFILE = {
  name: "Олена Коваленко",
  email: "olena@example.test",
  locale: "uk-UA",
  timeZone: "Europe/Kyiv",
};
const TOKEN_2 = "B".repeat(43);
// Built at run time so the CI job `secrets` (gitleaks) does not read it as a key (synthetic, ≥ 12 characters).
const NEW_PASSWORD = ["olena", "kyiv", "2026"].join("-");

// jsdom has no modal dialogs: `showModal` and `close` only toggle `open` here (the browser's top layer is real).
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal(): void; close(): void };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(() => cleanup());

const ok = (body: unknown): Reply => ({ status: 200, body });
const h1 = () => screen.getByRole("heading", { level: 1 }).textContent;
const dialog = () => screen.getByRole("dialog", { name: "Підтвердіть, що це ви" });
const callsTo = (calls: Call[], path: string) => calls.filter((c) => c.path === path);

async function openProfile(handlers: Record<string, Reply | ((c: Call) => Reply)> = {}) {
  const api = fakeApi({ "GET /v1/profile": ok(PROFILE), ...handlers });
  renderAt("#/settings/profile", api.client);
  await screen.findByRole("textbox", { name: /^Ім’я/ });
  return api;
}

async function startPasswordChange(newPassword = NEW_PASSWORD) {
  fireEvent.click(screen.getByRole("button", { name: "Змінити пароль" }));
  fireEvent.change(screen.getByLabelText(/^Новий пароль/), { target: { value: newPassword } });
  const save = screen.getByRole("button", { name: "Зберегти пароль" });
  save.focus();
  fireEvent.click(save);
}

function confirmWith(password: string) {
  fireEvent.change(within(dialog()).getByLabelText(/^Поточний пароль/), { target: { value: password } });
  fireEvent.click(within(dialog()).getByRole("button", { name: "Підтвердити" }));
}

describe("GRID-05@PoC S-186 «Налаштування»", () => {
  it("GRID-05@PoC FR 1, AC1: a header, then the settings navigation in 3 columns and the form in 9", async () => {
    const api = fakeApi({ "GET /v1/profile": ok(PROFILE) });
    renderAt("#/settings", api.client);
    expect(h1()).toBe("Налаштування");
    const nav = screen.getByRole("navigation", { name: "Розділи налаштувань" });
    expect(within(nav).getByRole("link", { name: "Загальне" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Профіль" }).getAttribute("href")).toBe(
      "#/settings/profile",
    );
    expect(within(nav).getByRole("link", { name: "Простір" }).getAttribute("href")).toBe(
      "#/settings/household",
    );
    const layout = nav.parentElement!;
    expect(layout.className).toBe("settings-layout");
    expect([...layout.children].map((c) => c.className)).toEqual(["settings-nav", "settings-form"]);

    // The columns at Expanded (1024 px) and wider: 12, the navigation spans 3, the form 9.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "settings.css"), "utf8");
    const expanded = css.slice(css.indexOf("@media (min-width: 1024px)"));
    expect(expanded).toMatch(
      /\.settings-layout \{[^}]*grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/,
    );
    expect(expanded).toMatch(/\.settings-nav \{\s*grid-column: span 3;/);
    expect(expanded).toMatch(/\.settings-form \{\s*grid-column: span 9;/);
    await screen.findByText(PROFILE.email);
  });

  it("GRID-05@PoC FR 2: «Налаштування» open from the profile menu; there is no «Ще» section", async () => {
    const api = fakeApi({ "GET /v1/profile": ok(PROFILE) });
    renderAt("#/planning/budget", api.client);
    const main = screen.getByRole("navigation", { name: "Основна навігація" });
    act(() =>
      within(main)
        .getByRole("button", { name: /Меню профілю/ })
        .click(),
    );
    const item = within(screen.getByRole("menu", { name: "Меню профілю" })).getByRole("menuitem", {
      name: "Налаштування",
    });
    expect(item.getAttribute("href")).toBe("#/settings");
    expect(within(main).queryByRole("link", { name: "Ще" })).toBeNull();
  });

  it("ACC-05@PoC AC2: no «Мова і формати» section and no language choice on «Налаштування»", async () => {
    const api = fakeApi({ "GET /v1/profile": ok(PROFILE) });
    renderAt("#/settings", api.client);
    await screen.findByText(PROFILE.name);
    expect(screen.queryByText(/Мова/)).toBeNull();
    expect(screen.queryByText(/формат/i)).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Профіль",
      "Простір",
      "Дані",
      "Модулі",
    ]);
  });

  it("ACC-05@PoC FR 4, AC6: the profile rows show the name and the email read-only; only name and password have «Змінити»", async () => {
    const api = fakeApi({ "GET /v1/profile": ok(PROFILE) });
    renderAt("#/settings", api.client);
    await screen.findByText(PROFILE.email);
    const links = screen.getAllByRole("link", { name: /^Змінити/ });
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual(["Змінити — Ім’я", "Змінити — Пароль"]);
    expect(links.every((l) => l.getAttribute("href") === "#/settings/profile")).toBe(true);
    expect(screen.queryByRole("link", { name: /Email/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Перейменувати — Назва простору" }).getAttribute("href")).toBe(
      "#/settings/household",
    );
    expect(screen.getByRole("link", { name: "Імпортувати — Імпорт виписок" }).getAttribute("href")).toBe(
      "#/import",
    );
  });

  it("ACC-05@PoC «Стани інтерфейсу»: loading placeholders, then an error with «Спробувати ще раз» and the code", async () => {
    let fail = true;
    const api = fakeApi({ "GET /v1/profile": () => (fail ? problem(500, "INTERNAL") : ok(PROFILE)) });
    renderAt("#/settings", api.client);
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Не вдалося завантажити профіль");
    expect(alert.textContent).toContain(`Код: ${SUPPORT_ID}`);
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Спробувати ще раз" }));
    await screen.findByText(PROFILE.name);
  });

  it("ACC-05@PoC «Стани інтерфейсу»: an ended session offers «Увійти» instead of a retry", async () => {
    const api = fakeApi({ "GET /v1/profile": problem(401, "SESSION_ENDED") });
    renderAt("#/settings/profile", api.client);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Сесію завершено. Увійдіть знову.");
    expect(within(alert).getByRole("link", { name: "Увійти" }).getAttribute("href")).toBe("#/login");
  });
});

describe("ACC-05@PoC S-187 «Профіль»", () => {
  it("ACC-05@PoC FR 1, AC6: initials, the name, the email read-only, «Змінити пароль» and «Зберегти»; no photo, phone or «Змінити email»", async () => {
    await openProfile();
    expect(h1()).toBe("Профіль");
    const crumbs = screen.getByRole("navigation", { name: "Хлібні крихти" });
    expect(within(crumbs).getByRole("link", { name: "Налаштування" }).getAttribute("href")).toBe(
      "#/settings",
    );
    expect(document.querySelector(".profile-initials")?.textContent).toBe("ОК");
    expect(screen.getByRole("textbox", { name: /^Ім’я/ })).toHaveProperty("value", PROFILE.name);
    expect(screen.getByText(PROFILE.email).tagName).toBe("SPAN");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Зберегти" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Змінити пароль" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Змінити email/ })).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/Телефон/)).toBeNull();
  });

  it("ACC-05@PoC AC1: «Зберегти» sends only the name and says «Профіль збережено»", async () => {
    const { calls } = await openProfile({
      "PATCH /v1/profile": (c) => ok({ ...PROFILE, ...(c.body as object) }),
    });
    fireEvent.change(screen.getByRole("textbox", { name: /^Ім’я/ }), {
      target: { value: "Олена Петренко " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    await screen.findByText("Профіль збережено");
    expect(
      callsTo(calls, "/v1/profile")
        .filter((c) => c.method === "PATCH")
        .map((c) => c.body),
    ).toEqual([{ name: "Олена Петренко" }]);
    expect(document.querySelector(".profile-initials")?.textContent).toBe("ОП");
  });

  it("ACC-05@PoC AC1, FR 2: another tab shows the new name as soon as it gets the focus back", async () => {
    let name = PROFILE.name;
    await openProfile({ "GET /v1/profile": () => ok({ ...PROFILE, name }) });
    name = "Олена Петренко";
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /^Ім’я/ })).toHaveProperty("value", "Олена Петренко"),
    );
    // A name being typed is not overwritten by a reload.
    fireEvent.change(screen.getByRole("textbox", { name: /^Ім’я/ }), { target: { value: "Моє" } });
    name = "Ще інше";
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await screen.findByText("Ще інше");
    expect(screen.getByRole("textbox", { name: /^Ім’я/ })).toHaveProperty("value", "Моє");
  });

  it("ACC-05@PoC «Стани інтерфейсу»: a failed save says «Не вдалося зберегти. Спробуйте ще раз» and keeps the typed name", async () => {
    await openProfile({ "PATCH /v1/profile": "network" });
    fireEvent.change(screen.getByRole("textbox", { name: /^Ім’я/ }), { target: { value: "Олена Петренко" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Не вдалося зберегти. Спробуйте ще раз");
    expect(screen.getByRole("textbox", { name: /^Ім’я/ })).toHaveProperty("value", "Олена Петренко");
  });

  it("ACC-05@PoC FR 1: an empty name is explained in the field and not sent", async () => {
    const { calls } = await openProfile();
    fireEvent.change(screen.getByRole("textbox", { name: /^Ім’я/ }), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    expect(screen.getByText("Введіть ім’я")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /^Ім’я/ }).getAttribute("aria-invalid")).toBe("true");
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([]);
  });
});

describe("ACC-05@PoC FR 5 password change with step-up (S-032)", () => {
  it("ACC-05@PoC AC5: a new password shorter than 12 characters is refused with an explanation; nothing is sent", async () => {
    const { calls } = await openProfile();
    await startPasswordChange("short-pass");
    expect(screen.getByText(/Пароль має бути не коротшим за 12 символів/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("ACC-05@PoC AC5, NFR-01@PoC AC7: the step-up dialog asks only the current password, then the new one is saved", async () => {
    const { calls } = await openProfile({
      "POST /v1/session/step-up": ok({ stepUpToken: TOKEN, expiresInS: 300 }),
      "POST /v1/profile/password": ok({ status: "password-changed" }),
    });
    await startPasswordChange();
    // Nothing is changed before the step-up.
    expect(callsTo(calls, "/v1/profile/password")).toEqual([]);
    const d = dialog();
    expect(d.getAttribute("aria-describedby")).toBeTruthy();
    expect(d.textContent).toContain("введіть поточний пароль");
    expect(d.querySelectorAll("input")).toHaveLength(1);
    expect(d.querySelector("input")?.getAttribute("autocomplete")).toBe("current-password");
    expect(document.activeElement).toBe(d.querySelector("input"));
    confirmWith("old-password-123");
    await screen.findByText(/Пароль змінено/);
    expect(callsTo(calls, "/v1/session/step-up").map((c) => c.body)).toEqual([
      { action: "password-change", password: "old-password-123" },
    ]);
    expect(callsTo(calls, "/v1/profile/password").map((c) => c.body)).toEqual([
      { password: NEW_PASSWORD, stepUpToken: TOKEN },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText(/^Новий пароль/)).toBeNull();
    expect(screen.getByText(/Пароль змінено/).closest("[role='status']")?.textContent).toContain(
      "Інші сесії завершено",
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Змінити пароль" }));
  });

  it("NFR-01@PoC AC7: focus is already on «Змінити пароль» in the commit that shows «Пароль змінено», not in a later effect", async () => {
    await openProfile({
      "POST /v1/session/step-up": ok({ stepUpToken: TOKEN, expiresInS: 300 }),
      "POST /v1/profile/password": ok({ status: "password-changed" }),
    });
    await startPasswordChange();
    // A MutationObserver callback runs right after the commit that adds the status, before any passive effect.
    const focusWhenShown = new Promise<Element | null>((resolve) => {
      const observer = new MutationObserver(() => {
        if (screen.queryByText(/Пароль змінено/)) {
          observer.disconnect();
          resolve(document.activeElement);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    confirmWith("old-password-123");
    expect(await focusWhenShown).toBe(screen.getByRole("button", { name: "Змінити пароль" }));
  });

  it("NFR-01@PoC AC6: a wrong current password says only «Пароль неправильний»; the field is cleared and nothing changes", async () => {
    const { calls } = await openProfile({
      "POST /v1/session/step-up": problem(403, "STEP_UP_PASSWORD_INVALID"),
    });
    await startPasswordChange();
    confirmWith("wrong-password");
    await within(dialog()).findByText("Пароль неправильний");
    const field = within(dialog()).getByLabelText(/^Поточний пароль/);
    expect(field).toHaveProperty("value", "");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(dialog().textContent).not.toMatch(/спроб|attempt|\d+ з/);
    expect(callsTo(calls, "/v1/profile/password")).toEqual([]);
  });

  it("CMP-21@PoC AC26: a wrong password in step-up shows «Пароль неправильний» under «Поточний пароль» with no hints; focus stays in the field and the message is announced", async () => {
    await openProfile({
      "POST /v1/session/step-up": problem(403, "STEP_UP_PASSWORD_INVALID"),
    });
    await startPasswordChange();
    confirmWith("wrong-password");
    await within(dialog()).findByText("Пароль неправильний");
    const field = within(dialog()).getByLabelText(/^Поточний пароль/);
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const wrap = field.closest(".auth-field")!;
    // No live region: the error is read when the focus lands on the field, through `aria-describedby`.
    const described = field
      .getAttribute("aria-describedby")!
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described.replace(/\s+/g, " ").trim()).toBe("Помилка. Пароль неправильний");
    expect(wrap.textContent).not.toMatch(/спроб|залиш|attempt|\d+ з/);
  });

  it("NFR-01@PoC AC6: at the lockout the dialog says «Вхід тимчасово заблоковано. Спробуйте через N хв» and offers only «Закрити»", async () => {
    const { calls } = await openProfile({
      "POST /v1/session/step-up": problem(429, "SIGN_IN_LOCKED", { "Retry-After": "840" }),
    });
    await startPasswordChange();
    confirmWith("wrong-password");
    const alert = await within(dialog()).findByRole("alert");
    expect(plain(alert.textContent)).toBe("Вхід тимчасово заблоковано. Спробуйте через 14 хв");
    expect(within(dialog()).queryByLabelText(/^Поточний пароль/)).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: "Підтвердити" })).toBeNull();
    expect(callsTo(calls, "/v1/profile/password")).toEqual([]);
    fireEvent.click(within(dialog()).getAllByRole("button", { name: "Закрити" }).at(-1)!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("NFR-01@PoC AC8: a confirmation the server no longer accepts makes the dialog ask the password again; the new one is used", async () => {
    let tokens = [TOKEN, TOKEN_2];
    const { calls } = await openProfile({
      "POST /v1/session/step-up": () => ok({ stepUpToken: tokens.shift(), expiresInS: 300 }),
      "POST /v1/profile/password": (c) =>
        (c.body as { stepUpToken: string }).stepUpToken === TOKEN
          ? problem(403, "STEP_UP_REQUIRED")
          : ok({ status: "password-changed" }),
    });
    await startPasswordChange();
    confirmWith("old-password-123");
    await within(await screen.findByRole("dialog")).findByText(/Підтвердження більше не діє/);
    confirmWith("old-password-123");
    await screen.findByText(/Пароль змінено/);
    expect(
      callsTo(calls, "/v1/profile/password").map((c) => (c.body as { stepUpToken: string }).stepUpToken),
    ).toEqual([TOKEN, TOKEN_2]);
    tokens = [];
  });

  it("S-032: Escape, «Скасувати» and «Закрити» close the dialog without a request; the focus returns to «Зберегти пароль»", async () => {
    const { calls } = await openProfile();
    for (const close of [
      () => fireEvent(dialog(), new Event("cancel", { cancelable: true })),
      () => fireEvent.click(within(dialog()).getByRole("button", { name: "Скасувати" })),
      () => fireEvent.click(within(dialog()).getByRole("button", { name: "Закрити" })),
    ]) {
      if (!screen.queryByLabelText(/^Новий пароль/)) await startPasswordChange();
      else {
        screen.getByRole("button", { name: "Зберегти пароль" }).focus();
        fireEvent.click(screen.getByRole("button", { name: "Зберегти пароль" }));
      }
      expect(dialog()).toBeTruthy();
      close();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Зберегти пароль" }));
    }
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("S-032: an empty current password is explained and not sent; the password is never kept after an answer", async () => {
    const { calls } = await openProfile({ "POST /v1/session/step-up": "network" });
    await startPasswordChange();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Підтвердити" }));
    expect(within(dialog()).getByText("Введіть пароль")).toBeTruthy();
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    confirmWith("old-password-123");
    expect((await within(dialog()).findByRole("alert")).textContent).toContain("Не вдалося з’єднатися");
    expect(within(dialog()).getByLabelText(/^Поточний пароль/)).toHaveProperty("value", "");
    expect(JSON.stringify({ ...localStorage })).not.toContain("old-password");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
  });
});
