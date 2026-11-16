import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import {
  fakeApi,
  plain,
  problem,
  renderAt,
  resetAuthState,
  SUPPORT_ID,
  type Call,
  type Reply,
} from "../auth/testing.tsx";

/**
 * ACC-08@PoC b) / ACC-06@PoC b) — «Налаштування → Простір» (S-200, canvas PocSettingsSpace) on `GET` and `PATCH
 * /v1/space`: the space's name with renaming, and the reporting currency, read only. Synthetic data only.
 */
const SPACE = { name: "Родина Коваль", dataRegion: "eu", reportingCurrency: "EUR" };
const PATH = "#/settings/household";

function api(over: Record<string, Reply | ((call: Call) => Reply | Promise<Reply>)> = {}) {
  return fakeApi({
    "GET /v1/space": { status: 200, body: SPACE },
    "PATCH /v1/space": (call) => ({
      status: 200,
      body: { ...SPACE, name: (call.body as { name: string }).name.trim() },
    }),
    ...over,
  });
}

/** A reply that waits until the test lets it go. */
function held(reply: Reply) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return { handler: () => gate.then(() => reply), release };
}

const nameField = () => screen.findByRole("textbox", { name: /Назва простору/ });
const save = () => screen.getByRole("button", { name: "Зберегти" });
const profile = () =>
  within(screen.getByRole("navigation", { name: "Основна навігація" })).getByRole("button", {
    name: /Меню профілю/,
  });

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

describe("ACC-08@PoC S-200 «Простір»", () => {
  it("ACC-08@PoC FR 5: «Налаштування → Простір» has the breadcrumbs, the heading and the one name field, filled in", async () => {
    renderAt(PATH, api().client);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Простір");
    const crumbs = screen.getByRole("navigation", { name: "Хлібні крихти" });
    expect(within(crumbs).getByRole("link", { name: "Налаштування" }).getAttribute("href")).toBe(
      "#/settings",
    );
    expect(within(crumbs).getByText("Простір").getAttribute("aria-current")).toBe("page");
    const field = (await nameField()) as HTMLInputElement;
    expect(field.value).toBe("Родина Коваль");
    expect(field.getAttribute("aria-required")).toBe("true");
    // The hint with the length rule and the counter is the field's description.
    const hint = document.getElementById(field.getAttribute("aria-describedby")!)!;
    expect(plain(hint.textContent)).toBe(
      "Від 1 до 60 символів · 13/60. Назву бачите лише ви; зміну записуємо в журнал дій.",
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(document.title).toContain("Простір");
  });

  it("ACC-08@PoC FR 5: «Налаштування» from the profile menu leads to «Простір»", () => {
    renderAt("#/settings", api().client);
    const link = within(screen.getByRole("main")).getByRole("link", { name: /Простір/ });
    expect(link.getAttribute("href")).toBe(PATH);
  });

  it("ACC-08@PoC AC5: «Родина Коваль» → «Коваль і батьки»: saved, the field and the profile show the new name", async () => {
    const { client, calls } = api();
    renderAt(PATH, client);
    const field = await nameField();
    await waitFor(() => expect(profile().textContent).toContain("Родина Коваль"));
    fireEvent.change(field, { target: { value: "Коваль і батьки" } });
    expect(document.getElementById(field.getAttribute("aria-describedby")!)!.textContent).toContain("15/60");
    fireEvent.click(save());
    expect(await screen.findByText("Назву збережено")).toBeTruthy();
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([
      expect.objectContaining({ path: "/v1/space", body: { name: "Коваль і батьки" } }),
    ]);
    expect((field as HTMLInputElement).value).toBe("Коваль і батьки");
    expect(profile().textContent).toContain("Коваль і батьки");
  });

  it("ACC-08@PoC AC5: an empty name, or one of invisible characters only, is not saved; the field says why and takes focus", async () => {
    const { client, calls } = api();
    renderAt(PATH, client);
    const field = await nameField();
    for (const value of ["", "   ", "​⁠"]) {
      fireEvent.change(field, { target: { value } });
      fireEvent.click(save());
      await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
      const error = document.getElementById(field.getAttribute("aria-describedby")!)!;
      expect(error.textContent).toContain("Помилка. Введіть назву простору.");
      await waitFor(() => expect(document.activeElement).toBe(field));
    }
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("ACC-08@PoC AC5: over 60 characters is not saved; exactly 60 (an emoji counts as one) is", async () => {
    const { client, calls } = api();
    renderAt(PATH, client);
    const field = await nameField();
    fireEvent.change(field, { target: { value: "а".repeat(61) } });
    fireEvent.click(save());
    await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText("Назва довша за 60 символів.")).toBeTruthy();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);

    const sixty = `${"а".repeat(59)}🏡`;
    fireEvent.change(field, { target: { value: sixty } });
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(document.getElementById(field.getAttribute("aria-describedby")!)!.textContent).toContain("60/60");
    fireEvent.click(save());
    expect(await screen.findByText("Назву збережено")).toBeTruthy();
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ name: sixty }]);
  });

  it("ACC-08@PoC AC5: a name the server refuses (400) is not saved: the field says why, the profile keeps the old name", async () => {
    renderAt(PATH, api({ "PATCH /v1/space": problem(400, "VALIDATION_FAILED") }).client);
    const field = await nameField();
    await waitFor(() => expect(profile().textContent).toContain("Родина Коваль"));
    fireEvent.change(field, { target: { value: "Рядок другий" } });
    fireEvent.click(save());
    await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText("Назва має бути від 1 до 60 символів в одному рядку.")).toBeTruthy();
    expect(profile().textContent).toContain("Родина Коваль");
    expect(screen.queryByText("Назву збережено")).toBeNull();
  });

  it("ACC-08@PoC FR 5: a failed save says «Не вдалося виконати дію. Спробуйте ще раз» with the code; nothing changes", async () => {
    renderAt(PATH, api({ "PATCH /v1/space": problem(500, "INTERNAL") }).client);
    const field = (await nameField()) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Коваль і батьки" } });
    fireEvent.click(save());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Не вдалося виконати дію. Спробуйте ще раз");
    expect(alert.textContent).toContain(`Код: ${SUPPORT_ID}`);
    // The typed name stays for another try; the space keeps its name.
    expect(field.value).toBe("Коваль і батьки");
    expect(profile().textContent).toContain("Родина Коваль");
  });

  it("ACC-08@PoC FR 5: no connection on save says so; «Скасувати» brings the saved name back and clears the message", async () => {
    renderAt(PATH, api({ "PATCH /v1/space": "network" }).client);
    const field = (await nameField()) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(save());
    await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Скасувати" }));
    expect(field.value).toBe("Родина Коваль");
    expect(field.getAttribute("aria-invalid")).toBeNull();
    fireEvent.change(field, { target: { value: "Інша назва" } });
    fireEvent.click(save());
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Не вдалося з’єднатися. Спробуйте ще раз",
    );
    fireEvent.click(screen.getByRole("button", { name: "Скасувати" }));
    expect(field.value).toBe("Родина Коваль");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ACC-08@PoC FR 5: while saving «Зберегти» is inactive and a second press or Enter sends nothing more", async () => {
    const gate = held({ status: 200, body: { ...SPACE, name: "Коваль і батьки" } });
    const { client, calls } = api({ "PATCH /v1/space": gate.handler });
    renderAt(PATH, client);
    const field = await nameField();
    fireEvent.change(field, { target: { value: "Коваль і батьки" } });
    // Enter in the field submits the form (keyboard).
    fireEvent.submit(field.closest("form")!);
    const submit = field.closest("form")!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    await waitFor(() => expect(submit.getAttribute("aria-disabled")).toBe("true"));
    expect(submit.textContent).toBe("Зберігаємо…");
    fireEvent.click(submit);
    fireEvent.submit(field.closest("form")!);
    await act(async () => {
      gate.release();
      await Promise.resolve();
    });
    expect(await screen.findByText("Назву збережено")).toBeTruthy();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(submit.getAttribute("aria-disabled")).toBeNull();
    expect(submit.textContent).toBe("Зберегти");
  });

  it("ACC-08@PoC FR 5: loading shows the skeleton of the settings, not an empty or stale field", async () => {
    const gate = held({ status: 200, body: SPACE });
    renderAt(PATH, api({ "GET /v1/space": gate.handler }).client);
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    await act(async () => {
      gate.release();
      await Promise.resolve();
    });
    expect(await nameField()).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("ACC-08@PoC FR 5: a failed load shows «✕ Помилка», what failed, «Спробувати ще раз» and «Код: …»; retry loads it", async () => {
    let fail = true;
    const { client } = api({
      "GET /v1/space": () => (fail ? problem(500, "INTERNAL") : { status: 200, body: SPACE }),
    });
    renderAt(PATH, client);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("✕ Помилка");
    expect(alert.textContent).toContain("Не вдалося завантажити налаштування простору.");
    expect(alert.textContent).toContain(`Код: ${SUPPORT_ID}`);
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Спробувати ще раз" }));
    expect(((await nameField()) as HTMLInputElement).value).toBe("Родина Коваль");
  });

  it("ACC-08@PoC FR 5: with the function switched off (404, 503) the page is the empty page of a function not there", async () => {
    for (const reply of [problem(404, "NOT_FOUND"), problem(503, "MODULE_UNAVAILABLE")]) {
      const { unmount } = renderAt(PATH, api({ "GET /v1/space": reply }).client);
      expect(await screen.findByText("Тут поки нічого немає")).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      unmount();
    }
  });
});

describe("ACC-08@PoC the space in the profile", () => {
  it("ACC-08@PoC FR 2: the profile at the bottom of the sidebar shows the space's name", async () => {
    renderAt("#/planning/budget", api().client);
    await waitFor(() => expect(profile().textContent).toContain("Родина Коваль"));
  });

  it("ACC-08@PoC AC2: the profile menu has no space switcher and no «Створити простір»", async () => {
    renderAt("#/planning/budget", api().client);
    await waitFor(() => expect(profile().textContent).toContain("Родина Коваль"));
    act(() => profile().click());
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((i) => i.querySelector(".ws-menu-label")?.textContent)).toEqual(["Налаштування"]);
    expect(screen.queryByText(/Створити простір|Перемкнути простір|Простори/)).toBeNull();
  });
});

describe("ACC-06@PoC reporting currency on S-200", () => {
  it("ACC-06@PoC FR 1: the reporting currency of the space is shown, EUR, read only — no control chooses it", async () => {
    renderAt(PATH, api().client);
    await nameField();
    const section = screen.getByRole("region", { name: "Валюта звітності" });
    expect(within(section).getByText("Валюта")).toBeTruthy();
    expect(section.textContent).toContain("EUR — задається під час створення простору і не змінюється");
    expect(within(section).queryByRole("combobox")).toBeNull();
    expect(within(section).queryByRole("radio")).toBeNull();
    expect(within(section).queryByRole("textbox")).toBeNull();
    expect(within(section).queryByRole("button")).toBeNull();
  });

  it("ACC-06@PoC AC2: with the locale uk-UA the space reports in EUR and offers no choice of currency anywhere on S-200", async () => {
    const { client, calls } = api();
    renderAt(PATH, client);
    await nameField();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/UAH|гривн/i)).toBeNull();
    fireEvent.change(await nameField(), { target: { value: "Коваль і батьки" } });
    fireEvent.click(save());
    await screen.findByText("Назву збережено");
    // A rename sends the name only; the currency is never part of it.
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ name: "Коваль і батьки" });
    expect(screen.getByRole("region", { name: "Валюта звітності" }).textContent).toContain("EUR");
  });
});

describe("ACC-08@PoC the space in the profile after signing in", () => {
  it("ACC-08@PoC FR 2: a shell seen signed out, then sign-in in the same tab — the profile shows the space's name", async () => {
    let signedIn = false;
    const { client } = api({
      "GET /v1/space": () => (signedIn ? { status: 200, body: SPACE } : problem(401, "UNAUTHENTICATED")),
    });
    renderAt("#/planning/budget", client);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      window.location.hash = "#/login";
      await new Promise((r) => setTimeout(r, 20));
    });
    signedIn = true;
    await act(async () => {
      window.location.hash = "#/planning/budget";
      await new Promise((r) => setTimeout(r, 20));
    });
    await waitFor(() => expect(profile().textContent).toContain("Родина Коваль"));
  });
});
