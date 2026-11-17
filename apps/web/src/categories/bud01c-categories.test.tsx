import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
import type { Category, Group, Tree } from "./api.ts";

/**
 * BUD-01@PoC c) — S-196 «Налаштування → Категорії» (canvas PocSettingsCategories and its «Тексти» board) on the
 * routes of module `categories`: `GET /v1/categories`, `POST /v1/category-groups`, `PATCH
 * /v1/category-groups/{id}`, `POST /v1/categories`, `PATCH /v1/categories/{id}`, `POST …/merge`, `DELETE …`.
 * The server's own checks (types, emptiness, audit, other spaces) are its integration tests; these check what the
 * screen offers and sends. Synthetic data only.
 */
const PATH = "#/settings/categories";
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function cat(groupId: string, name: string, over: Partial<Category> = {}): Category {
  return {
    id: uuid(),
    groupId,
    systemKey: name.toLowerCase(),
    kind: "expense",
    name,
    renamed: false,
    icon: "shapes",
    color: "#5872D2",
    iconTone: "white",
    essential: false,
    hidden: false,
    deletable: false,
    ...over,
  };
}

function group(name: string, kind: Group["kind"], tone: string, build: (id: string) => Category[]): Group {
  const id = uuid();
  return { id, systemKey: name.toLowerCase(), kind, name, renamed: false, tone, categories: build(id) };
}

function tree(): Tree {
  n = 0;
  return {
    groups: [
      group("Житло", "expense", "#5872D2", (g) => [
        cat(g, "Оренда", { color: "#144097", icon: "key-round", essential: true }),
        cat(g, "Комунальні", { color: "#494BAB", icon: "zap", essential: true }),
        cat(g, "Сад", { color: "#959FFE", icon: "sprout", iconTone: "ink" }),
      ]),
      group("Харчування", "expense", "#0E9161", (g) => [
        cat(g, "Продукти", { color: "#045D2F", icon: "shopping-cart", essential: true }),
        cat(g, "Кафе і ресторани", { color: "#099673", icon: "coffee" }),
        cat(g, "Кава", { systemKey: null, color: "#0E9161" }),
        cat(g, "Кава з собою", { systemKey: null, color: "#0E9161", deletable: true }),
      ]),
      group("Відпочинок", "expense", "#0F899B", (g) => [
        cat(g, "Подорожі", { color: "#05585E", icon: "plane", hidden: true }),
      ]),
      group("Дохід від роботи", "income", "#BA4E84", (g) => [
        cat(g, "Зарплата", { kind: "income", color: "#7A165C", icon: "wallet", essential: null }),
      ]),
      group("Службові", "service", "#9AA3AF", (g) => [
        cat(g, "Переказ", {
          kind: "service",
          color: "#9DB2C8",
          icon: "arrow-left-right",
          iconTone: "ink",
          essential: null,
        }),
        cat(g, "Коригування", {
          kind: "service",
          color: "#9AA3AF",
          icon: "scale",
          iconTone: "ink",
          essential: null,
        }),
      ]),
    ],
  };
}

type Handler = Reply | ((call: Call) => Reply | Promise<Reply>);

function api(over: Record<string, Handler> = {}, data: Tree = tree()) {
  return { data, ...fakeApi({ "GET /v1/categories": { status: 200, body: data }, ...over }) };
}

const byName = (data: Tree, name: string) =>
  data.groups.flatMap((g) => g.categories).find((c) => c.name === name)!;
const row = (name: string) =>
  screen.getAllByRole("listitem").find((li) => li.querySelector(".cat-name")?.textContent === name)!;
/** Opens the «…» of a category's row and returns its menu. */
function openMenu(name: string) {
  fireEvent.click(within(row(name)).getByRole("button", { name: "Ще дії" }));
  return screen.getByRole("menu", { name: `Дії категорії «${name}»` });
}
const items = (menu: HTMLElement) =>
  [...menu.querySelectorAll('[role^="menuitem"]')].map((i) => plain(i.textContent));
const gets = (calls: readonly Call[]) =>
  calls.filter((c) => c.method === "GET" && c.path === "/v1/categories");
const sent = (calls: readonly Call[], method: string) => calls.filter((c) => c.method === method);
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

/** Chooses `name` in a «з пошуком» field: open, type, first match, Enter. */
function choose(label: RegExp, name: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  const search = screen.getByRole("combobox");
  fireEvent.change(search, { target: { value: name } });
  const option = screen.getAllByRole("option").find((o) => o.textContent === name)!;
  const index = screen.getAllByRole("option").indexOf(option);
  for (let i = 0; i <= index; i++) fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

describe("BUD-01@PoC S-196 «Категорії»", () => {
  it("BUD-01@PoC AC5: the tree of groups and categories with «Нова група», «Нова категорія» and the menu «Перейменувати», «Об’єднати з іншою…», «Приховати»; «Кава» merged into «Кафе і ресторани» goes to the server and the tree is read again", async () => {
    const { client, calls, data } = api({
      [`POST /v1/categories/${byName(tree(), "Кава").id}/merge`]: (call) => ({
        status: 200,
        body: {
          sourceId: byName(data, "Кава").id,
          targetId: (call.body as { targetId: string }).targetId,
          sourceState: "retired",
        },
      }),
    });
    renderAt(PATH, client);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Категорії");
    const crumbs = screen.getByRole("navigation", { name: "Хлібні крихти" });
    expect(within(crumbs).getByRole("link", { name: "Налаштування" }).getAttribute("href")).toBe(
      "#/settings",
    );
    await screen.findByText("Оренда");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => plain(h.textContent))).toEqual([
      "Житло· 3 · витрата",
      "Харчування· 4 · витрата",
      "Відпочинок· 0 · витрата",
      "Дохід від роботи· 1 · дохід",
      "Службові· 2 · службова",
    ]);
    expect(screen.getByRole("button", { name: "Нова група" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Нова категорія" })).toBeTruthy();

    const menu = openMenu("Кава");
    expect(items(menu)).toEqual(
      expect.arrayContaining(["Перейменувати", "Іконка і колір", "Об’єднати з іншою…", "Приховати"]),
    );
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Об’єднати з іншою…" }));
    const dialog = await screen.findByRole("dialog", { name: "Об’єднати «Кава» з іншою категорією" });
    const merge = within(dialog).getByRole("button", { name: "Об’єднати" });
    expect(merge.getAttribute("aria-disabled")).toBe("true");
    choose(/Об’єднати з/, "Кафе і ресторани");
    expect(merge.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(merge);
    await waitFor(() => expect(gets(calls)).toHaveLength(2));
    const [post] = sent(calls, "POST");
    expect(post!.path).toBe(`/v1/categories/${byName(data, "Кава").id}/merge`);
    expect(post!.body).toEqual({ targetId: byName(data, "Кафе і ресторани").id });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("BUD-01@PoC AC6: «Кава» with «Зарплата» is refused with «Категорії різних типів не можна об'єднати» and nothing is sent; the same answer from the server shows the same words", async () => {
    const { client, calls, data } = api({
      [`POST /v1/categories/${tree().groups[1]!.categories[2]!.id}/merge`]: problem(
        409,
        "CATEGORY_KINDS_DIFFER",
      ),
    });
    renderAt(PATH, client);
    await screen.findByText("Кава");
    fireEvent.click(within(openMenu("Кава")).getByRole("menuitem", { name: "Об’єднати з іншою…" }));
    const dialog = await screen.findByRole("dialog");
    choose(/Об’єднати з/, "Зарплата");
    expect(within(dialog).getByText(/Категорії різних типів не можна об'єднати/)).toBeTruthy();
    const merge = within(dialog).getByRole("button", { name: "Об’єднати" });
    expect(merge.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(merge);
    expect(sent(calls, "POST")).toHaveLength(0);

    // A target whose type changed since the tree was read: the server's refusal, the data unchanged.
    choose(/Об’єднати з/, "Продукти");
    fireEvent.click(within(dialog).getByRole("button", { name: "Об’єднати" }));
    expect(await within(dialog).findByText("Категорії різних типів не можна об'єднати")).toBeTruthy();
    expect(sent(calls, "POST")[0]!.body).toEqual({ targetId: byName(data, "Продукти").id });
    expect(gets(calls)).toHaveLength(1);
  });

  it("BUD-01@PoC AC7: a system category's menu has «Приховати» and no «Видалити»; hidden, it leaves the list until «Показати приховані»", async () => {
    const { client, calls, data } = api({
      [`PATCH /v1/categories/${tree().groups[2]!.categories[0]!.id}`]: { status: 200, body: {} },
    });
    renderAt(PATH, client);
    await screen.findByText("Оренда");
    // «Подорожі» is hidden: not in the list until the toggle; the toggle counts the hidden ones.
    expect(screen.queryByText("Подорожі")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Показати приховані · 1" }));
    expect(within(row("Подорожі")).getByText("приховано")).toBeTruthy();
    expect(items(openMenu("Подорожі"))).toEqual([
      "Перейменувати",
      "Іконка і колір",
      "Обов’язкова",
      "Показати",
    ]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    const menu = openMenu("Сад");
    expect(items(menu)).toContain("Приховати");
    expect(items(menu)).not.toContain("Видалити");
    expect(within(menu).queryByText(/не можна видалити/)).toBeNull();
    fireEvent.keyDown(menu, { key: "Escape" });
    fireEvent.click(within(openMenu("Подорожі")).getByRole("menuitem", { name: "Показати" }));
    await waitFor(() => expect(gets(calls)).toHaveLength(2));
    expect(sent(calls, "PATCH")[0]!.body).toEqual({ hidden: false });
    expect(sent(calls, "PATCH")[0]!.path).toBe(`/v1/categories/${byName(data, "Подорожі").id}`);
  });

  it("BUD-01@PoC FR 3: «Переказ» and «Коригування» cannot be hidden or merged, and their group has no menu", async () => {
    const { client } = api();
    renderAt(PATH, client);
    await screen.findByText("Переказ");
    for (const name of ["Переказ", "Коригування"]) {
      const menu = openMenu(name);
      expect(items(menu)).toEqual(["Перейменувати", "Іконка і колір"]);
      fireEvent.keyDown(menu, { key: "Escape" });
    }
    const head = screen
      .getByRole("region", { name: "Службові" })
      .querySelector<HTMLElement>(".cat-group-head")!;
    expect(within(head).queryByRole("button", { name: "Ще дії" })).toBeNull();
  });

  it("BUD-01@PoC AC15: an income category «Зарплата» has no «Обов’язкова» in its menu and no badge", async () => {
    const { client } = api();
    renderAt(PATH, client);
    await screen.findByText("Зарплата");
    const menu = openMenu("Зарплата");
    expect(items(menu)).not.toContain("Обов’язкова");
    expect(within(menu).queryByRole("menuitemcheckbox")).toBeNull();
    expect(within(row("Зарплата")).queryByText("обов'язкова")).toBeNull();
  });

  it("BUD-01@PoC AC16: «обов'язкова» is on for «Оренда», «Комунальні», «Продукти» and off for the others; turning it off for «Продукти» sends essential: false", async () => {
    const { client, calls, data } = api({
      [`PATCH /v1/categories/${tree().groups[1]!.categories[0]!.id}`]: { status: 200, body: {} },
    });
    renderAt(PATH, client);
    await screen.findByText("Оренда");
    for (const name of ["Оренда", "Комунальні", "Продукти"])
      expect(within(row(name)).getByText("обов'язкова")).toBeTruthy();
    for (const name of ["Сад", "Кафе і ресторани", "Кава"])
      expect(within(row(name)).queryByText("обов'язкова")).toBeNull();
    const sad = within(openMenu("Сад")).getByRole("menuitemcheckbox", { name: "Обов’язкова" });
    expect(sad.getAttribute("aria-checked")).toBe("false");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    const groceries = within(openMenu("Продукти")).getByRole("menuitemcheckbox", { name: "Обов’язкова" });
    expect(groceries.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(groceries);
    await waitFor(() => expect(gets(calls)).toHaveLength(2));
    expect(sent(calls, "PATCH")).toEqual([
      expect.objectContaining({
        path: `/v1/categories/${byName(data, "Продукти").id}`,
        body: { essential: false },
      }),
    ]);
  });

  it("BUD-01@PoC AC17: «Оренда», «Комунальні», «Сад» and «Продукти» show their own colours, white icons and a dark `ink` one on «Сад»", async () => {
    const { client } = api();
    renderAt(PATH, client);
    await screen.findByText("Оренда");
    const disc = (name: string) => row(name).querySelector<HTMLElement>(".ws-category-disc")!;
    expect(disc("Оренда").style.backgroundColor).toBe(rgb("#144097"));
    expect(disc("Комунальні").style.backgroundColor).toBe(rgb("#494BAB"));
    expect(disc("Сад").style.backgroundColor).toBe(rgb("#959FFE"));
    expect(disc("Продукти").style.backgroundColor).toBe(rgb("#045D2F"));
    expect(["Оренда", "Комунальні", "Продукти"].map((c) => disc(c).dataset.iconTone)).toEqual([
      "white",
      "white",
      "white",
    ]);
    expect(disc("Сад").dataset.iconTone).toBe("ink");
    expect(disc("Оренда").dataset.icon).toBe("key-round");
    expect(disc("Оренда").querySelector("svg")).not.toBeNull();
  });

  it("BUD-01@PoC AC18: the empty custom «Кава з собою» has «Видалити»; confirmed, the category goes and the tree is read again", async () => {
    const data = tree();
    let deleted = false;
    const id = byName(data, "Кава з собою").id;
    const { client, calls } = api(
      {
        "GET /v1/categories": () => ({
          status: 200,
          body: deleted
            ? {
                groups: data.groups.map((g) => ({
                  ...g,
                  categories: g.categories.filter((c) => c.id !== id),
                })),
              }
            : data,
        }),
        [`DELETE /v1/categories/${id}`]: () => {
          deleted = true;
          return { status: 200, body: { deleted: true } };
        },
      },
      data,
    );
    renderAt(PATH, client);
    await screen.findByText("Кава з собою");
    const menu = openMenu("Кава з собою");
    const item = within(menu).getByRole("menuitem", { name: "Видалити" });
    expect(items(menu).at(-1)).toBe("Видалити");
    fireEvent.click(item);
    const dialog = await screen.findByRole("alertdialog", { name: "Видалити категорію «Кава з собою»?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Видалити" }));
    await waitFor(() => expect(screen.queryByText("Кава з собою")).toBeNull());
    expect(sent(calls, "DELETE").map((c) => c.path)).toEqual([`/v1/categories/${id}`]);
  });

  it("BUD-01@PoC AC19: «Кава» with transactions offers no «Видалити», only «Приховати» and «Об’єднати з іншою…» with the reason; a refused delete says the same and changes nothing", async () => {
    const data = tree();
    const stale = byName(data, "Кава з собою");
    const { client, calls } = api(
      { [`DELETE /v1/categories/${stale.id}`]: problem(409, "CATEGORY_NOT_EMPTY") },
      data,
    );
    renderAt(PATH, client);
    await screen.findByText("Кава");
    const menu = openMenu("Кава");
    expect(items(menu)).not.toContain("Видалити");
    expect(items(menu)).toEqual(expect.arrayContaining(["Приховати", "Об’єднати з іншою…"]));
    const reason =
      "Категорію з транзакціями, правилами або лімітами не можна видалити — приховайте або об'єднайте її";
    expect(within(menu).getByText(reason)).toBeTruthy();
    expect(document.getElementById(menu.getAttribute("aria-describedby")!)!.textContent).toBe(reason);
    fireEvent.keyDown(menu, { key: "Escape" });

    // The tree said «Кава з собою» was empty, but a transaction came meanwhile: the server's refusal is shown.
    fireEvent.click(within(openMenu("Кава з собою")).getByRole("menuitem", { name: "Видалити" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Видалити" }));
    expect(await within(dialog).findByText(reason)).toBeTruthy();
    expect(gets(calls)).toHaveLength(1);
    expect(screen.getByText("Кава з собою")).toBeTruthy();
  });

  it("BUD-01@PoC FR 2: «Нова група» with its type, «Нова категорія» in a group, renaming, and «Така назва вже існує» for a taken name", async () => {
    const data = tree();
    const { client, calls } = api(
      {
        "POST /v1/category-groups": { status: 201, body: { ...data.groups[0], categories: [] } },
        "POST /v1/categories": problem(409, "CATEGORY_NAME_TAKEN"),
        [`PATCH /v1/categories/${byName(data, "Сад").id}`]: { status: 200, body: byName(data, "Сад") },
      },
      data,
    );
    renderAt(PATH, client);
    await screen.findByText("Оренда");

    fireEvent.click(screen.getByRole("button", { name: "Нова група" }));
    let dialog = await screen.findByRole("dialog", { name: "Нова група" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Назва/ }), {
      target: { value: " Домашні улюбленці " },
    });
    fireEvent.change(within(dialog).getByRole("combobox", { name: /Тип/ }), { target: { value: "expense" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Додати групу" }));
    await waitFor(() => expect(gets(calls)).toHaveLength(2));
    const group = sent(calls, "POST")[0]!;
    expect(group.path).toBe("/v1/category-groups");
    expect(group.body).toEqual({ name: "Домашні улюбленці", kind: "expense" });

    fireEvent.click(screen.getByRole("button", { name: "Нова категорія" }));
    dialog = await screen.findByRole("dialog", { name: "Нова категорія" });
    const groupSelect = within(dialog).getByRole("combobox", { name: /Група/ }) as HTMLSelectElement;
    // «Службові» takes no custom categories.
    expect([...groupSelect.options].map((o) => o.textContent)).not.toContain("Службові");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Назва/ }), { target: { value: "Кава" } });
    fireEvent.change(groupSelect, { target: { value: data.groups[1]!.id } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Додати категорію" }));
    expect(await within(dialog).findByText("Така назва вже існує")).toBeTruthy();
    expect(sent(calls, "POST")[1]!.body).toEqual({ name: "Кава", groupId: data.groups[1]!.id });
    fireEvent.click(within(dialog).getByRole("button", { name: "Скасувати" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(within(openMenu("Сад")).getByRole("menuitem", { name: "Перейменувати" }));
    dialog = await screen.findByRole("dialog", { name: "Перейменувати «Сад»" });
    const name = within(dialog).getByRole("textbox", { name: /Назва/ }) as HTMLInputElement;
    expect(name.value).toBe("Сад");
    fireEvent.change(name, { target: { value: "Сад і город" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(gets(calls)).toHaveLength(3));
    expect(sent(calls, "PATCH")[0]!.body).toEqual({ name: "Сад і город" });
  });

  it("BUD-01@PoC FR 2: «Нова категорія» from a group's «…» has that group chosen; a group is renamed from the same menu", async () => {
    const data = tree();
    const { client, calls } = api(
      {
        "POST /v1/categories": { status: 201, body: byName(data, "Кава") },
        [`PATCH /v1/category-groups/${data.groups[2]!.id}`]: { status: 200, body: data.groups[2] },
      },
      data,
    );
    renderAt(PATH, client);
    await screen.findByText("Оренда");
    fireEvent.click(screen.getAllByRole("button", { name: "Ще дії" })[0]!);
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Дії групи «Житло»" })).getByRole("menuitem", {
        name: "Нова категорія в групі",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Нова категорія" });
    expect((within(dialog).getByRole("combobox", { name: /Група/ }) as HTMLSelectElement).value).toBe(
      data.groups[0]!.id,
    );
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Назва/ }), {
      target: { value: "Ремонт даху" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Додати категорію" }));
    await waitFor(() => expect(gets(calls)).toHaveLength(2));
    expect(sent(calls, "POST")[0]!.body).toEqual({ name: "Ремонт даху", groupId: data.groups[0]!.id });

    const leisure = screen.getByRole("region", { name: "Відпочинок" });
    fireEvent.click(within(leisure).getByRole("button", { name: "Ще дії" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Перейменувати" }));
    const rename = await screen.findByRole("dialog", { name: "Перейменувати «Відпочинок»" });
    fireEvent.change(within(rename).getByRole("textbox", { name: /Назва/ }), {
      target: { value: "Дозвілля" },
    });
    fireEvent.click(within(rename).getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(gets(calls)).toHaveLength(3));
    expect(sent(calls, "PATCH")[0]).toEqual(
      expect.objectContaining({
        path: `/v1/category-groups/${data.groups[2]!.id}`,
        body: { name: "Дозвілля" },
      }),
    );
  });

  it("BUD-01@PoC FR 10: «Іконка і колір» offers the icons and colours of the tree and saves the chosen ones", async () => {
    const data = tree();
    const kava = byName(data, "Кава");
    const { client, calls } = api({ [`PATCH /v1/categories/${kava.id}`]: { status: 200, body: kava } }, data);
    renderAt(PATH, client);
    await screen.findByText("Кава");
    fireEvent.click(within(openMenu("Кава")).getByRole("menuitem", { name: "Іконка і колір" }));
    const dialog = await screen.findByRole("dialog", { name: "Іконка і колір «Кава»" });
    const iconGroup = within(dialog).getByRole("group", { name: "Іконка" });
    const icons = within(iconGroup).getAllByRole("radio");
    expect(icons.find((r) => (r as HTMLInputElement).checked)!.getAttribute("aria-label")).toBe("Загальна");
    fireEvent.click(within(iconGroup).getByRole("radio", { name: "Як у «Кафе і ресторани»" }));
    const colours = within(within(dialog).getByRole("group", { name: "Колір" })).getAllByRole("radio");
    expect(colours.map((c) => (c as HTMLInputElement).value)).toContain("#144097");
    fireEvent.click(colours.find((c) => (c as HTMLInputElement).value === "#099673")!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(gets(calls)).toHaveLength(2));
    expect(sent(calls, "PATCH")[0]!.body).toEqual({ icon: "coffee", color: "#099673" });
  });

  it("BUD-01@PoC «Стани інтерфейсу»: with no custom category the hint «Додайте власну категорію»; a search shows the groups it finds or «Нічого не знайдено»", async () => {
    const data = tree();
    for (const g of data.groups) g.categories = g.categories.filter((c) => c.systemKey !== null);
    const { client } = api({}, data);
    renderAt(PATH, client);
    expect(await screen.findByText("Додайте власну категорію")).toBeTruthy();
    const search = screen.getByRole("searchbox", { name: "Знайти категорію" });
    fireEvent.change(search, { target: { value: "сад" } });
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.querySelector(".cat-group-name")!.textContent),
    ).toEqual(["Житло"]);
    expect(screen.getByText("Сад")).toBeTruthy();
    expect(screen.queryByText("Оренда")).toBeNull();
    fireEvent.change(search, { target: { value: "яхта" } });
    expect(screen.getByRole("status").textContent).toBe("Нічого не знайдено");
  });

  it("BUD-01@PoC «Стани інтерфейсу»: loading — the skeleton of the tree; an error — «Не вдалося завантажити категорії. Спробуйте ще раз», «Спробувати ще раз» and the code; the retry reads again", async () => {
    let fail = true;
    const { client, calls } = api({
      "GET /v1/categories": () => (fail ? problem(500, "INTERNAL") : { status: 200, body: tree() }),
    });
    renderAt(PATH, client);
    expect(document.querySelector(".cat-tree[aria-busy='true'] .ws-skeleton")).not.toBeNull();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Не вдалося завантажити категорії. Спробуйте ще раз")).toBeTruthy();
    expect(within(alert).getByText(`Код: ${SUPPORT_ID}`)).toBeTruthy();
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByText("Оренда")).toBeTruthy();
    expect(gets(calls)).toHaveLength(2);
  });

  it("BUD-01@PoC «Стани інтерфейсу»: a failed save keeps the data and says «Помилка» with the code", async () => {
    const data = tree();
    const { client } = api(
      { [`PATCH /v1/categories/${byName(data, "Сад").id}`]: problem(500, "INTERNAL") },
      data,
    );
    renderAt(PATH, client);
    await screen.findByText("Сад");
    fireEvent.click(within(openMenu("Сад")).getByRole("menuitem", { name: "Приховати" }));
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toBe(
      `Помилка. Не вдалося зберегти зміни. Спробуйте ще раз.Код: ${SUPPORT_ID}`,
    );
    expect(within(row("Сад")).queryByText("приховано")).toBeNull();
  });

  it("S-196 opens from «Налаштування»: «Налаштування» leads to «Категорії» from «Модулі»", () => {
    const { client } = api();
    renderAt("#/settings", client);
    const link = within(screen.getByRole("main")).getByRole("link", { name: /Налаштувати — Категорії/ });
    expect(link.getAttribute("href")).toBe(PATH);
  });
});
