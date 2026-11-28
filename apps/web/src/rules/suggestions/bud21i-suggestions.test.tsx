import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { formatDate } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider, createAuthClient } from "../../auth/api.ts";
import { App } from "../../App.tsx";
import { plain, resetAuthState } from "../../auth/testing.tsx";
import { resetNavigationSession } from "../../routing/session.ts";
import { resetReviewCount } from "../../transactions/reviewCount.ts";

/**
 * BUD-21@PoC i) (wave 2, row 241): S-301 «Пропозиції правил», S-302 «Прийняти правила», the pencil (S-198 for a
 * suggestion) and the count and the mark «з історії» on S-197 (canvas PocMoneySuggestions, PocMoneySuggestionsStates,
 * PocMoneySuggestionAccept, PocMoneySuggestionEdit, PocMoneyRulesHistory; texts in their «Тексти» boards) on the merged
 * server routes of `categorization` (rows 235–237). The fake API answers as the server does; what the engine derives and
 * what an acceptance writes are the server's own tests. Synthetic data only.
 */
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });

const BATCH = "00000000-0000-4000-8000-0000000000b1";
const RUN = "00000000-0000-4000-8000-0000000000d1";
const APPLY = "00000000-0000-4000-8000-0000000000e1";
const RULE = "00000000-0000-4000-8000-0000000000f1";
const FOOD = "00000000-0000-4000-8000-0000000000c1";
const FUEL = "00000000-0000-4000-8000-0000000000c2";
const SUBS = "00000000-0000-4000-8000-0000000000c3";
const FUN = "00000000-0000-4000-8000-0000000000c4";
const TRANSFER = "00000000-0000-4000-8000-0000000000c5";
const GONE = "00000000-0000-4000-8000-0000000000c9";
const PATH = "#/money/transactions/rules/suggestions";
const DERIVATIONS = "GET /v1/category-rule-derivations";
const ONE = `GET /v1/category-rule-derivations/${RUN}`;
const ACCEPT = `POST /v1/category-rule-derivations/${RUN}/accept`;
const MATCHES = `POST /v1/category-rule-derivations/${RUN}/matches`;

type Reply = { status: number; body?: unknown } | "network";
type Sent = { method: string; path: string; body: unknown };
type Handler = Reply | ((call: Sent) => Reply | Promise<Reply>);

function fake(over: Record<string, Handler> = {}) {
  const sent: Sent[] = [];
  const handlers: Record<string, Handler> = {
    "GET /v1/categories": { status: 200, body: { groups: GROUPS } },
    "GET /v1/accounts": { status: 200, body: { items: [], nextCursor: null } },
    "GET /v1/transaction-tags": { status: 200, body: { items: [] } },
    "GET /v1/category-rules": { status: 200, body: { items: [] } },
    "GET /v1/category-rule-runs": { status: 200, body: { items: [] } },
    [`GET /v1/import/history-files/${BATCH}`]: {
      status: 200,
      body: { batch: { fileName: "istoriya-2025.xlsx", id: BATCH } },
    },
    ...over,
  };
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    const call: Sent = {
      method: request.method,
      path: url.pathname,
      body: text ? (JSON.parse(text) as unknown) : undefined,
    };
    sent.push(call);
    const handler = handlers[`${call.method} ${call.path}`];
    const reply = typeof handler === "function" ? await handler(call) : handler;
    if (reply === undefined) return new Response(null, { status: 599 });
    if (reply === "network") throw new TypeError("Failed to fetch");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    client: createAuthClient(fetchImpl as typeof fetch),
    sent,
    writes: () => sent.filter((s) => s.method !== "GET"),
    of: (method: string, path: string) => sent.filter((s) => s.method === method && s.path === path),
    set: (key: string, handler: Handler) => {
      handlers[key] = handler;
    },
  };
}
type Fake = ReturnType<typeof fake>;

const category = (id: string, name: string, groupId: string) => ({
  id,
  groupId,
  systemKey: null,
  kind: "expense",
  name,
  renamed: false,
  icon: "shapes",
  color: "#5872D2",
  iconTone: "white",
  essential: null,
  hidden: false,
  deletable: true,
});
const GROUPS = [
  {
    id: "g1",
    systemKey: null,
    kind: "expense",
    name: "Щоденне",
    renamed: false,
    tone: "#5872D2",
    categories: [
      category(FOOD, "Продукти", "g1"),
      category(FUEL, "Пальне", "g1"),
      category(SUBS, "Підписки", "g1"),
      category(FUN, "Розваги", "g1"),
    ],
  },
  {
    id: "g2",
    systemKey: "service",
    kind: "service",
    name: "Службові",
    renamed: false,
    tone: "#566174",
    categories: [{ ...category(TRANSFER, "Переказ", "g2"), kind: "service" }],
  },
];

const merchant = (value: string) => ({ field: "merchant", operator: "equals", value });
const suggestion = (ordinal: number, over: Record<string, unknown> = {}) => ({
  ordinal,
  kind: "confident",
  action: "category",
  conditions: [merchant(`Мерчант ${ordinal}`)],
  categoryId: FOOD,
  matched: 15,
  agreeing: 14,
  since: null,
  tags: [],
  evidence: { rows: [2, 5, 9], more: false },
  exceptions: { items: [], count: 0 },
  existing: 3,
  conflict: null,
  selected: true,
  categoryDeleted: false,
  ...over,
});
const conflicting = (ordinal: number, over: Record<string, unknown> = {}) =>
  suggestion(ordinal, {
    kind: "conflicting",
    selected: false,
    conflict: { ruleId: RULE, position: 3 },
    ...over,
  });
const derivation = (over: Record<string, unknown> = {}) => ({
  id: RUN,
  batchId: BATCH,
  status: "completed",
  background: false,
  count: 600,
  processed: 600,
  createdAt: "2026-11-20T10:00:00Z",
  endedAt: "2026-11-20T10:01:00Z",
  ...over,
});
const READY_CHECK = { status: "ready", rows: 120, covered: 98, agreeing: 89, minimum: 50 };
const view = (suggestions: unknown[], over: Record<string, unknown> = {}) => ({
  derivation: derivation(),
  check: READY_CHECK,
  existing: { imported: 300, matched: 120, descriptionsDiffer: false, truncated: false },
  suggestions,
  ...over,
});
const list = (pending: number, over: Record<string, unknown> = {}) => ({
  items: [{ derivation: derivation(over), pending }],
  pending,
});
const serve = (suggestions: unknown[], over: Record<string, unknown> = {}): Record<string, Handler> => ({
  [DERIVATIONS]: { status: 200, body: list(suggestions.length) },
  [ONE]: { status: 200, body: view(suggestions, over) },
});
const accepted = (count: number, over: Record<string, unknown> = {}) => ({
  rules: Array.from({ length: count }, (_, i) => ({ id: `r${i}`, position: 4 + i })),
  tagsCreated: 0,
  transfers: 0,
  run: null,
  ...over,
});
const run = (over: Record<string, unknown> = {}) => ({
  id: APPLY,
  ruleId: RULE,
  status: "completed",
  background: false,
  derivationId: RUN,
  count: 180,
  processed: 180,
  changed: 175,
  skipped: { manual: 5, unchanged: 0, unavailable: 0 },
  truncated: false,
  undo: { available: true, until: "2026-12-04T10:00:00Z", restored: 0, notRestored: 0 },
  createdAt: "2026-11-27T10:00:00Z",
  endedAt: "2026-11-27T10:00:05Z",
  ...over,
});

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  resetReviewCount();
});

function open(a: Fake, hash = PATH) {
  window.location.hash = hash;
  return render(
    <AuthApiProvider value={a.client}>
      <App />
    </AuthApiProvider>,
  );
}
const ready = () => screen.findByRole("heading", { level: 1, name: "Пропозиції правил" });
const group = (name: RegExp) => screen.getByRole("group", { name });
const rowOf = (text: string) =>
  screen
    .getAllByRole("listitem")
    .find((li) => li.classList.contains("sug-row") && plain(li.textContent).includes(text))!;
const bar = () => screen.getByRole("region", { name: "Панель вибору" });
const acceptButton = () => within(bar()).getByRole("button", { name: "Прийняти вибране" });
const dialog = () => screen.getByRole("dialog", { name: "Прийняти правила" });

describe("BUD-21@PoC i) S-301 «Пропозиції правил»", () => {
  it("BUD-21@PoC FR 21: the groups «Впевнені», «Суперечливі» and «Переказ»; a row shows its conditions, category, counts, habit change, existing transactions, tag and conflict; the checkboxes follow the defaults; the file rows and the exceptions open under the row", async () => {
    const a = fake(
      serve([
        suggestion(1, {
          conditions: [merchant("Сільпо")],
          matched: 15,
          agreeing: 14,
          existing: 23,
          exceptions: {
            items: [{ row: 7, date: "2025-08-14", amount: "-412.50", currency: "UAH", categoryId: FUEL }],
            count: 1,
          },
        }),
        suggestion(2, {
          conditions: [
            merchant("Glovo"),
            { field: "amount", operator: "greater", value: { amount: "40.00", currency: "EUR" } },
          ],
          since: "2025-06-01",
          tags: ["родина"],
          categoryId: SUBS,
        }),
        conflicting(3, { conditions: [merchant("Spotify")], categoryId: FUN, matched: 9, agreeing: 6 }),
        suggestion(4, {
          action: "transfer",
          conditions: [{ field: "description", operator: "contains", value: "На свою картку" }],
          categoryId: TRANSFER,
          selected: true,
        }),
      ]),
    );
    open(a);
    await ready();
    expect(
      screen.getByText(
        "Виведено з файлу istoriya-2025.xlsx. Пропозиція — ще не правило: вона нічого не змінює, доки ви її не приймете.",
      ),
    ).toBeTruthy();
    const confident = within(group(/Впевнені · 2/));
    expect(confident.getByText("Вибрані за замовчуванням.")).toBeTruthy();
    expect(within(group(/Суперечливі · 1/)).getByText(/За замовчуванням не вибрані/)).toBeTruthy();
    expect(within(group(/Переказ · 1/)).getByText(/вкладці «Пари»/)).toBeTruthy();

    const silpo = rowOf("Сільпо");
    expect(plain(silpo.textContent)).toContain("Якщо Мерчант = Сільпо");
    expect(plain(silpo.textContent)).toContain(
      "15 рядків, 14 збігаються з категорією · Підходить наявних транзакцій: 23",
    );
    expect(within(silpo).getByText("Продукти")).toBeTruthy();
    const glovo = rowOf("Glovo");
    expect(plain(glovo.textContent)).toContain("Мерчант = Glovo · сума > 40,00 €");
    expect(plain(glovo.textContent)).toContain(
      `Зміна звички: транзакції відносите до цієї категорії з ${plain(formatDate("uk", "2025-06-01"))}`,
    );
    expect(plain(glovo.textContent)).toContain("Тег: родина");
    expect(plain(rowOf("Spotify").textContent)).toContain("Суперечить правилу № 3");

    const boxes = (row: HTMLElement) => within(row).getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(boxes(silpo).checked).toBe(true);
    expect(boxes(glovo).checked).toBe(true);
    expect(boxes(rowOf("Spotify")).checked).toBe(false);
    expect(boxes(rowOf("На свою картку")).checked).toBe(false);
    expect(screen.getByText("Вибрано: 2")).toBeTruthy();

    // The evidence and the exceptions open under the row.
    expect(within(silpo).queryByText(/Винятки у файлі/)).toBeNull();
    fireEvent.click(within(silpo).getByRole("button", { name: "Рядки файлу" }));
    expect(within(silpo).getByRole("button", { name: "Сховати рядки файлу" })).toBeTruthy();
    expect(plain(silpo.textContent)).toContain("Рядки файлу: 2, 5, 9");
    const exceptions = within(silpo).getByRole("group", { name: "Винятки у файлі · 1" });
    expect(plain(exceptions.textContent)).toContain(plain(formatDate("uk", "2025-08-14")));
    expect(plain(exceptions.textContent)).toContain("412,50 ₴");
    expect(plain(exceptions.textContent)).toContain("Пальне");
    expect(plain(exceptions.textContent)).toContain("Нічого виправляти не потрібно.");

    // «Вибрати всі в групі» selects the conflicting group; nothing is written by selecting.
    const all = within(group(/Суперечливі/)).getByLabelText("Вибрати всі в групі");
    fireEvent.click(all);
    expect(screen.getByText("Вибрано: 3")).toBeTruthy();
    expect(a.writes()).toEqual([]);
  });

  it("BUD-21@PoC FR 21: the pencil opens «Змінити пропозицію» with the conditions filled in; saving changes only the suggestion — no rule is created, no box «Застосувати до …» — and the changed suggestion becomes selected", async () => {
    const a = fake(
      serve([suggestion(1), conflicting(2, { conditions: [merchant("Spotify")], categoryId: FUN })]),
    );
    open(a);
    await ready();
    const spotify = rowOf("Spotify");
    expect((within(spotify).getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(spotify).getByRole("button", { name: /Змінити пропозицію/ }));
    const form = await screen.findByRole("dialog", { name: "Змінити пропозицію" });
    expect(
      within(form).getByText("Це лише пропозиція: правило з'явиться, коли ви приймете вибране."),
    ).toBeTruthy();
    expect((within(form).getByDisplayValue("Spotify") as HTMLInputElement).value).toBe("Spotify");
    expect(within(form).queryByText(/Застосувати до/)).toBeNull();
    expect(within(form).queryByRole("button", { name: "Зберегти правило" })).toBeNull();
    fireEvent.change(within(form).getByDisplayValue("Spotify"), { target: { value: "Spotify AB" } });
    fireEvent.click(within(form).getByRole("button", { name: "Зберегти пропозицію" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Змінити пропозицію" })).toBeNull());
    expect(plain(rowOf("Spotify AB").textContent)).toContain("Якщо Мерчант = Spotify AB");
    expect((within(rowOf("Spotify AB")).getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true);
    expect(a.writes()).toEqual([]);
    expect(a.of("POST", "/v1/category-rules")).toEqual([]);

    // The change goes to the server only with the acceptance.
    a.set(MATCHES, { status: 200, body: { count: 0, transfers: 0, truncated: false } });
    a.set(ACCEPT, { status: 201, body: accepted(2) });
    fireEvent.click(acceptButton());
    await screen.findByRole("dialog", { name: "Прийняти правила" });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Прийняти 2" }));
    await screen.findByText(/Створено правил: 2/);
    const sent = a.of("POST", `/v1/category-rule-derivations/${RUN}/accept`)[0]!.body as {
      suggestions: { ordinal: number; rule?: { conditions: unknown[]; categoryId: string } }[];
    };
    expect(sent.suggestions.map((s) => s.ordinal)).toEqual([1, 2]);
    expect(sent.suggestions[0]).toEqual({ ordinal: 1 });
    expect(sent.suggestions[1]!.rule!.conditions).toEqual([merchant("Spotify AB")]);
    expect(sent.suggestions[1]!.rule!.categoryId).toBe(FUN);
  });

  it("BUD-21@PoC FR 22 and AC24: accepting the selected 40 confident suggestions without the box creates the rules only; the 6 conflicting stay; the dialog says what will happen; the box is off by default", async () => {
    const confident = Array.from({ length: 40 }, (_, i) =>
      suggestion(i + 1, i === 0 ? { tags: ["родина"] } : {}),
    );
    const clash = Array.from({ length: 6 }, (_, i) => conflicting(41 + i));
    const a = fake({
      ...serve([...confident, ...clash]),
      [MATCHES]: { status: 200, body: { count: 180, transfers: 0, truncated: false } },
      [ACCEPT]: { status: 201, body: accepted(40, { tagsCreated: 1 }) },
    });
    open(a);
    await ready();
    expect(screen.getByText("Вибрано: 40")).toBeTruthy();
    fireEvent.click(acceptButton());
    const box = await screen.findByRole("dialog", { name: "Прийняти правила" });
    expect(
      within(box).getByText(
        "Буде створено правил: 40. Вони отримають позначку «з історії» і стануть нижче за ваші наявні правила. Між собою їх впорядковано за кількістю умов, потім за кількістю рядків.",
      ),
    ).toBeTruthy();
    expect(await within(box).findByText("Буде створено тег: родина")).toBeTruthy();
    const apply = await within(box).findByRole("checkbox", { name: /Застосувати до 180/ });
    expect((apply as HTMLInputElement).checked).toBe(false);
    expect(
      within(box).getByText("Без цього прапорця категорії наявних транзакцій не змінюються."),
    ).toBeTruthy();
    // Opening the dialog only counts (`matches`); nothing is created before the button.
    expect(a.writes().map((w) => w.path)).toEqual([`/v1/category-rule-derivations/${RUN}/matches`]);
    // The server decides the order of the new rules; the page sends only the ordinals, never `apply`.
    a.set(DERIVATIONS, { status: 200, body: list(6) });
    a.set(ONE, { status: 200, body: view(clash) });
    fireEvent.click(within(box).getByRole("button", { name: "Прийняти 40" }));
    expect(
      await screen.findByText("Створено правил: 40. Категорії наявних транзакцій не змінено."),
    ).toBeTruthy();
    const accepts = a.of("POST", `/v1/category-rule-derivations/${RUN}/accept`);
    expect(accepts).toHaveLength(1);
    expect(a.writes().map((w) => w.path)).toEqual([
      `/v1/category-rule-derivations/${RUN}/matches`,
      `/v1/category-rule-derivations/${RUN}/accept`,
    ]);
    const body = accepts[0]!.body as { suggestions: { ordinal: number }[]; apply?: boolean };
    expect(body.suggestions.map((s) => s.ordinal)).toEqual(confident.map((s) => s.ordinal));
    expect(body.apply).toBeUndefined();
    // The 6 conflicting ones are still there, not selected.
    await waitFor(() => expect(screen.getByRole("group", { name: /Суперечливі · 6/ })).toBeTruthy());
    expect(screen.queryByRole("group", { name: /Впевнені/ })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Прийняти правила" })).toBeNull();
  });

  it("BUD-21@PoC FR 22 and AC25: with «Застосувати до наявних» the run is shown with the 175 changed and the 5 skipped for manual changes, and «Скасувати застосування» undoes it; transactions a «Переказ» rule leaves untouched are counted (owner decision 2026-11-28)", async () => {
    const a = fake({
      ...serve([suggestion(1), suggestion(2, { action: "transfer", categoryId: TRANSFER, conflict: null })]),
      [MATCHES]: { status: 200, body: { count: 180, transfers: 4, truncated: false } },
      [ACCEPT]: { status: 201, body: accepted(2, { transfers: 4, run: run() }) },
      [`POST /v1/category-rule-runs/${APPLY}/undo`]: {
        status: 200,
        body: run({
          status: "undone",
          undo: { available: false, until: null, restored: 175, notRestored: 0 },
        }),
      },
      [`GET /v1/category-rule-runs/${APPLY}`]: { status: 200, body: run() },
    });
    open(a);
    await ready();
    fireEvent.click(within(group(/Переказ/)).getAllByRole("checkbox")[0]!);
    expect(screen.getByText("Вибрано: 2")).toBeTruthy();
    fireEvent.click(acceptButton());
    const box = await screen.findByRole("dialog", { name: "Прийняти правила" });
    expect(
      within(box).getByText(
        "Правила «Переказ» (1) не змінюють транзакції самі: нові транзакції пішли б на вкладку «Пари» на підтвердження.",
      ),
    ).toBeTruthy();
    expect(
      await within(box).findByText(
        "Наявних транзакцій, яких стосується правило «Переказ»: 4. Вони лишаться без змін.",
      ),
    ).toBeTruthy();
    fireEvent.click(await within(box).findByRole("checkbox", { name: /Застосувати до 180/ }));
    expect(
      within(box).getByText(/Ручні категорії, перекази й розділені транзакції не змінюються/),
    ).toBeTruthy();
    fireEvent.click(within(box).getByRole("button", { name: "Прийняти 2" }));
    const notice = await screen.findByText(
      "Створено правил: 2. Категорії отримали 175 транзакцій, пропущено через ручні зміни: 5.",
    );
    expect(
      (a.of("POST", `/v1/category-rule-derivations/${RUN}/accept`)[0]!.body as { apply?: boolean }).apply,
    ).toBe(true);
    const card = notice.closest("section")!;
    expect(within(card).getByText("Пропущено через правила «Переказ»: 4.")).toBeTruthy();
    expect(
      within(card).getByText(`Скасувати можна до ${plain(formatDate("uk", "2026-12-04"))}`),
    ).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Скасувати застосування" }));
    expect(await screen.findByText(/Запуск відмінено: відновлено 175/)).toBeTruthy();
    expect(a.of("POST", `/v1/category-rule-runs/${APPLY}/undo`)).toHaveLength(1);
  });

  it("BUD-21@PoC FR 22 (progress): a run over more than 500 transactions shows «Застосовуємо правила до наявних транзакцій · X з N» until it ends", async () => {
    const a = fake({
      ...serve([suggestion(1)]),
      [MATCHES]: { status: 200, body: { count: 900, transfers: 0, truncated: false } },
      [ACCEPT]: {
        status: 201,
        body: accepted(1, {
          run: run({ status: "running", background: true, count: 900, processed: 420, changed: 0 }),
        }),
      },
      [`GET /v1/category-rule-runs/${APPLY}`]: {
        status: 200,
        body: run({ status: "running", count: 900, processed: 420 }),
      },
    });
    open(a);
    await ready();
    fireEvent.click(acceptButton());
    const box = await screen.findByRole("dialog", { name: "Прийняти правила" });
    fireEvent.click(await within(box).findByRole("checkbox", { name: /Застосувати до 900/ }));
    fireEvent.click(within(box).getByRole("button", { name: "Прийняти 1" }));
    expect(
      (await screen.findAllByText("Застосовуємо правила до наявних транзакцій · 420 з 900")).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Скасувати застосування" })).toBeNull();
  });

  it("BUD-21@PoC FR 22 (refusals): a deleted category, a changed list, the rule limit and a failure each say so, nothing is created and the dialog stays open", async () => {
    const a = fake({
      ...serve([suggestion(1)]),
      [MATCHES]: { status: 200, body: { count: 0, transfers: 0, truncated: false } },
    });
    open(a);
    await ready();
    fireEvent.click(acceptButton());
    const box = await screen.findByRole("dialog", { name: "Прийняти правила" });
    await within(box).findByText("Наявних транзакцій, що підходять, немає");
    const go = () => fireEvent.click(within(dialog()).getByRole("button", { name: "Прийняти 1" }));
    const refuse = (status: number, code: string) =>
      a.set(ACCEPT, { status, body: { type: "about:blank", title: code, status, code } });
    refuse(409, "HISTORY_SUGGESTION_CATEGORY_DELETED");
    go();
    expect(
      await screen.findByText(
        "Категорію пропозиції видалено: правило не створено. Змініть пропозицію або відхиліть її.",
      ),
    ).toBeTruthy();
    refuse(409, "HISTORY_SUGGESTIONS_CHANGED");
    go();
    expect(await screen.findByText(/Пропозиції вже змінились/)).toBeTruthy();
    refuse(422, "LIMIT_REACHED");
    go();
    expect(await screen.findByText("Правил забагато: можна мати до 500")).toBeTruthy();
    refuse(500, "INTERNAL");
    go();
    expect(
      await screen.findByText("Не вдалося прийняти правила. Нічого не створено, спробуйте ще раз."),
    ).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Прийняти правила" })).toBeTruthy();
    expect(screen.queryByText(/Створено правил/)).toBeNull();
  });

  it("BUD-21@PoC FR 22 (conflicts): the dialog counts the selected suggestions that conflict with a rule and says the existing rules act first", async () => {
    const a = fake({
      ...serve([suggestion(1), conflicting(2)]),
      [MATCHES]: { status: 200, body: { count: 0, transfers: 0, truncated: false } },
    });
    open(a);
    await ready();
    fireEvent.click(within(group(/Суперечливі/)).getAllByRole("checkbox")[0]!);
    fireEvent.click(acceptButton());
    const box = await screen.findByRole("dialog", { name: "Прийняти правила" });
    expect(
      within(box).getByText(
        "Серед вибраних суперечливих із вашими правилами: 1. Вони стоять нижче за наявні, тож наявні діятимуть першими.",
      ),
    ).toBeTruthy();
  });

  it("BUD-21@PoC FR 23: «Відхилити» removes the suggestion for good — the request names the derivation and the suggestion — and «Відхилити вибране» rejects every selected one", async () => {
    const a = fake({
      ...serve([
        suggestion(1, { conditions: [merchant("Сільпо")] }),
        suggestion(2, { conditions: [merchant("АТБ")] }),
        conflicting(3),
      ]),
      [`POST /v1/category-rule-derivations/${RUN}/suggestions/1/reject`]: {
        status: 200,
        body: { rejected: true },
      },
      [`POST /v1/category-rule-derivations/${RUN}/suggestions/2/reject`]: {
        status: 200,
        body: { rejected: true },
      },
    });
    open(a);
    await ready();
    a.set(ONE, {
      status: 200,
      body: view([suggestion(2, { conditions: [merchant("АТБ")] }), conflicting(3)]),
    });
    fireEvent.click(within(rowOf("Сільпо")).getByRole("button", { name: /Відхилити/ }));
    expect(await screen.findByText("Пропозицію відхилено. Вона більше не з'являтиметься.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/Мерчант = Сільпо/)).toBeNull());
    expect(a.writes().map((w) => w.path)).toEqual([
      `/v1/category-rule-derivations/${RUN}/suggestions/1/reject`,
    ]);
    expect(a.writes()[0]!.body).toEqual({});

    a.set(ONE, { status: 200, body: view([conflicting(3)]) });
    fireEvent.click(within(bar()).getByRole("button", { name: "Відхилити вибране" }));
    await waitFor(() => expect(screen.queryByText(/Мерчант = АТБ/)).toBeNull());
    expect(a.writes().map((w) => w.path)).toEqual([
      `/v1/category-rule-derivations/${RUN}/suggestions/1/reject`,
      `/v1/category-rule-derivations/${RUN}/suggestions/2/reject`,
    ]);
  });

  it("BUD-21@PoC FR 23 (failure): a rejection the server refused says so and keeps the suggestion", async () => {
    const a = fake({
      ...serve([suggestion(1, { conditions: [merchant("Сільпо")] })]),
      [`POST /v1/category-rule-derivations/${RUN}/suggestions/1/reject`]: {
        status: 500,
        body: { type: "about:blank", title: "x", status: 500, code: "INTERNAL" },
      },
    });
    open(a);
    await ready();
    fireEvent.click(within(rowOf("Сільпо")).getByRole("button", { name: /Відхилити/ }));
    expect(await screen.findByText("Не вдалося виконати дію. Спробуйте ще раз.")).toBeTruthy();
    expect(rowOf("Сільпо")).toBeTruthy();
  });

  it("S-301 «Видалити файл» (the user's action of BUD-21 FR 24 only; the 30 days and the cleanup are the server's tests): after the confirmation the file and its rows go, the page reads again and the unaccepted suggestions are gone", async () => {
    const a = fake({
      ...serve([suggestion(1)]),
      [`DELETE /v1/import/history-files/${BATCH}`]: { status: 200, body: { deleted: true } },
    });
    open(a);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Видалити файл" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Видалити файл історії?" });
    expect(a.writes()).toEqual([]);
    a.set(DERIVATIONS, { status: 200, body: { items: [], pending: 0 } });
    fireEvent.click(within(confirm).getByRole("button", { name: "Видалити файл" }));
    expect(await screen.findByText("Пропозицій немає")).toBeTruthy();
    expect(a.writes().map((w) => `${w.method} ${w.path}`)).toEqual([
      `DELETE /v1/import/history-files/${BATCH}`,
    ]);
  });

  it("BUD-21@PoC AC20: over the suggestions the coverage and the match of the check on the history are shown with the rows they come from; for a short file an explanation takes the place of the numbers", async () => {
    const a = fake(serve([suggestion(1)], { count: 600 }));
    a.set(ONE, { status: 200, body: view([suggestion(1)], { derivation: derivation({ count: 600 }) }) });
    open(a);
    await ready();
    const check = screen.getByRole("region", { name: "Перевірка на вашій історії" });
    expect(plain(check.textContent)).toContain("Покриття: 82 %");
    expect(plain(check.textContent)).toContain(
      "частка останніх 120 рядків, що отримали категорію від правил",
    );
    expect(plain(check.textContent)).toContain("Збіг: 91 %");
    expect(plain(check.textContent)).toContain("частка покритих рядків, де категорія збіглася з вашою");
    expect(plain(check.textContent)).toContain(
      "Правила виведено з перших 480 рядків за датою й перевірено на останніх 120.",
    );
  });

  it("BUD-21@PoC AC20 (short file): 40 rows — instead of numbers the page says there is too little history", async () => {
    const a = fake({
      [DERIVATIONS]: { status: 200, body: list(1, { count: 40 }) },
      [ONE]: {
        status: 200,
        body: view([suggestion(1)], {
          derivation: derivation({ count: 40 }),
          check: { status: "too_short", rows: 40, covered: null, agreeing: null, minimum: 50 },
        }),
      },
    });
    open(a);
    await ready();
    const check = screen.getByRole("region", { name: "Перевірка на вашій історії" });
    expect(plain(check.textContent)).toContain(
      "Історії замало для перевірки: потрібно щонайменше 50 рядків із розбором, а у файлі їх 40.",
    );
    expect(plain(check.textContent)).not.toMatch(/Покриття|Збіг/);
  });

  it("BUD-21@PoC AC21: when the descriptions differ the page warns, and each suggestion shows how many existing transactions it fits", async () => {
    const a = fake(
      serve([suggestion(1, { conditions: [merchant("Сільпо")], existing: 12 })], {
        existing: { imported: 300, matched: 12, descriptionsDiffer: true, truncated: false },
      }),
    );
    open(a);
    await ready();
    expect(plain(screen.getByText(/Описи у файлі, схоже/).textContent)).toBe(
      "! Описи у файлі, схоже, відрізняються від описів вашого банку: пропозиції підходять лише до 12 із 300 транзакцій, імпортованих із виписок. Правила можуть не спрацювати на нових виписках.",
    );
    expect(plain(rowOf("Сільпо").textContent)).toContain("Підходить наявних транзакцій: 12");
  });

  it("BUD-21@PoC AC21 (no warning): the warning is absent when the descriptions agree", async () => {
    const a = fake(serve([suggestion(1)]));
    open(a);
    await ready();
    expect(screen.queryByText(/відрізняються від описів вашого банку/)).toBeNull();
  });

  it("BUD-21@PoC EC8: a suggestion whose category was deleted cannot be selected until the pencil gives it another one; one whose category was merged shows the target category", async () => {
    const a = fake(
      serve([
        suggestion(1, {
          conditions: [merchant("Rozetka")],
          categoryId: GONE,
          categoryDeleted: true,
          selected: false,
        }),
        suggestion(2, { conditions: [merchant("Netflix")], categoryId: SUBS }),
      ]),
    );
    open(a);
    await ready();
    // The server answers with the target of a merged category; the page shows it.
    expect(within(rowOf("Netflix")).getByText("Підписки")).toBeTruthy();
    const row = rowOf("Rozetka");
    const box = within(row).getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(within(row).getByText("Категорію видалено: змініть пропозицію або відхиліть її")).toBeTruthy();
    // Only the suggestion with a category is counted in the bar.
    expect(screen.getByText("Вибрано: 1")).toBeTruthy();
  });
});

describe("BUD-21@PoC i) S-301 states", () => {
  it("BUD-21@PoC FR 21 (empty): no derivation — «Пропозицій немає» with the upload action", async () => {
    const a = fake({ [DERIVATIONS]: { status: 200, body: { items: [], pending: 0 } } });
    open(a);
    await ready();
    expect(await screen.findByText("Пропозицій немає")).toBeTruthy();
    expect(
      screen.getByText(
        "Завантажте файл історії, у якому ви розібрали транзакції за категоріями, і ми запропонуємо правила.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Завантажити файл історії" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: "Панель вибору" })).toBeNull();
  });

  it("BUD-21@PoC FR 21 (too few rows): a derivation with no suggestion for a short file says how many rows a suggestion needs", async () => {
    const a = fake(
      serve([], { check: { status: "too_short", rows: 12, covered: null, agreeing: null, minimum: 50 } }),
    );
    open(a);
    await ready();
    expect(
      await screen.findByText(
        "Із цього файлу правил не вийшло: рядків замало. Для пропозиції потрібно щонайменше 3 рядки з однаковою категорією або 5 рядків, більшість яких має одну категорію.",
      ),
    ).toBeTruthy();
  });

  it("BUD-21@PoC FR 21 (loading): the derivation runs — «оброблено X з N рядків» and a skeleton; then the suggestions appear", async () => {
    const a = fake({
      [DERIVATIONS]: { status: 200, body: list(0, { status: "running", count: 2400, processed: 1200 }) },
      [ONE]: {
        status: 200,
        body: {
          derivation: derivation({ status: "running", count: 2400, processed: 1200 }),
          check: null,
          existing: null,
          suggestions: [],
        },
      },
    });
    open(a);
    await ready();
    expect(await screen.findByText("Виводимо правила · оброблено 1200 з 2400 рядків")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("BUD-21@PoC FR 21 (error): a failed read says «Не вдалося вивести правила» with «Спробувати ще раз», and a failed derivation can be started again", async () => {
    const a = fake({
      [DERIVATIONS]: {
        status: 500,
        body: { type: "about:blank", title: "x", status: 500, code: "INTERNAL" },
      },
    });
    open(a);
    await ready();
    expect(await screen.findByText("Не вдалося вивести правила")).toBeTruthy();
    a.set(DERIVATIONS, { status: 200, body: list(1) });
    a.set(ONE, { status: 200, body: view([suggestion(1)]) });
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByRole("group", { name: /Впевнені · 1/ })).toBeTruthy();

    const b = fake({
      [DERIVATIONS]: { status: 200, body: list(0, { status: "failed" }) },
      [ONE]: {
        status: 200,
        body: { derivation: derivation({ status: "failed" }), check: null, existing: null, suggestions: [] },
      },
      "POST /v1/category-rule-derivations": {
        status: 201,
        body: { derivation: derivation({ status: "running", processed: 0 }), started: true },
      },
    });
    open(b);
    expect(await screen.findAllByText("Не вдалося вивести правила")).not.toHaveLength(0);
    const retry = screen.getAllByRole("button", { name: "Спробувати ще раз" });
    fireEvent.click(retry[retry.length - 1]!);
    await waitFor(() => expect(b.of("POST", "/v1/category-rule-derivations")).toHaveLength(1));
    expect(b.of("POST", "/v1/category-rule-derivations")[0]!.body).toEqual({ batchId: BATCH });
  });

  it("BUD-21@PoC FR 21 (off): when the function is switched off the page says so and shows no action", async () => {
    const a = fake({
      [DERIVATIONS]: {
        status: 404,
        body: { type: "about:blank", title: "x", status: 404, code: "NOT_FOUND" },
      },
    });
    open(a);
    await ready();
    expect(await screen.findByText("Правила з історії для цього простору вимкнено.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Завантажити файл історії" })).toBeNull();
  });
});

describe("BUD-21@PoC i) S-197 «Правила категорій» and BUD-14 FR 16", () => {
  const SILPO = { field: "merchant", operator: "equals", value: "Сільпо" };
  const rule = (id: string, position: number, text: string, origin: "history" | null) => ({
    id,
    position,
    conditions: [{ field: "merchant", operator: "equals", value: text }],
    accountIds: [],
    categoryId: FOOD,
    enabled: true,
    tags: [],
    needsAttention: null,
    appliedCount: 0,
    origin,
  });

  it("BUD-14@PoC FR 16 and BUD-21@PoC AC26: the heading of the page links to «Пропозиції правил · 46» when suggestions are not accepted, and a rule from a suggestion carries the mark «з історії» in the column «Умова»", async () => {
    const a = fake({
      [DERIVATIONS]: { status: 200, body: list(46) },
      "GET /v1/category-rules": {
        status: 200,
        body: {
          items: [
            rule("a", 1, "Netflix", null),
            rule("b", 2, "Shell", "history"),
            rule("c", 3, "АТБ", "history"),
            rule("d", 4, "Сільпо", "history"),
          ],
        },
      },
    });
    open(a, "#/money/transactions/rules");
    const link = await screen.findByRole("link", { name: "Пропозиції правил · 46" });
    expect(link.getAttribute("href")).toBe("#/money/transactions/rules/suggestions");
    // BUD-21 FR 22, AC26: the accepted rules stand below the existing one in the server's order; each has the mark.
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => plain(r.textContent))).toEqual([
      expect.stringContaining("Netflix"),
      expect.stringContaining("Shell"),
      expect.stringContaining("АТБ"),
      expect.stringContaining("Сільпо"),
    ]);
    expect(rows.map((r) => within(r).queryByText("з історії") !== null)).toEqual([false, true, true, true]);
    expect(
      screen.getByText(
        /Правила з позначкою «з історії» стоять нижче за ваші наявні правила; їх змінюють, вимикають і впорядковують так само\./,
      ),
    ).toBeTruthy();
    expect(a.writes()).toEqual([]);
    expect(SILPO.value).toBe("Сільпо");
  });

  it("BUD-14@PoC FR 16 (no suggestions): without unaccepted suggestions the link has no number, and a table without such rules has no mark", async () => {
    const a = fake({
      [DERIVATIONS]: { status: 200, body: { items: [], pending: 0 } },
      "GET /v1/category-rules": { status: 200, body: { items: [rule("a", 1, "Netflix", null)] } },
    });
    open(a, "#/money/transactions/rules");
    const link = await screen.findByRole("link", { name: "Пропозиції правил" });
    expect(link.textContent).toBe("Пропозиції правил");
    await screen.findByRole("table");
    expect(screen.queryByText("з історії")).toBeNull();
  });

  it("BUD-21@PoC FR 21 (entry): the link on S-197 opens the page of suggestions", async () => {
    const a = fake({
      [DERIVATIONS]: { status: 200, body: list(1) },
      [ONE]: { status: 200, body: view([suggestion(1)]) },
    });
    open(a, "#/money/transactions/rules");
    const link = await screen.findByRole("link", { name: "Пропозиції правил · 1" });
    await act(async () => {
      fireEvent.click(link);
      window.location.hash = "#/money/transactions/rules/suggestions";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByRole("group", { name: /Впевнені · 1/ })).toBeTruthy();
  });
});

describe("BUD-21@PoC i) S-299 → S-301", () => {
  it("BUD-21@PoC FR 21 (entry after the derivation): when the derivation ends the step «Перевірка розпізнавання» links to «Пропозиції правил»", async () => {
    const recognition = {
      table: { headerRow: 1, dataRows: 600, evidence: [] },
      encoding: null,
      delimiter: null,
      columns: [],
      dates: null,
      numbers: null,
      sign: null,
      examples: [],
      labels: { items: [], more: false },
      transfers: { values: [], more: false },
      accounts: { values: [], more: false },
      summary: { rows: 600, read: 600, transfers: 0, skipped: [], tagsSkipped: 0 },
      missing: [],
      mapping: { labels: [], groups: [], historyGroups: [], more: false },
    };
    const file = {
      batch: {
        id: BATCH,
        state: "parsed",
        version: 1,
        createdAt: "2026-11-20T10:00:00Z",
        lastActionAt: "2026-11-20T10:00:00Z",
        deleteAfter: "2026-12-20T10:00:00Z",
        fileName: "istoriya-2025.xlsx",
        format: "xlsx",
        sizeBytes: 1000,
        confirmedAt: null,
      },
      parseId: "00000000-0000-4000-8000-0000000000b2",
      parse: { state: "parsed", refusal: null, engineVersion: "1" },
      confirmed: null,
      recognition,
      canConfirm: true,
    };
    const a = fake({
      [`GET /v1/import/history-files/${BATCH}`]: { status: 200, body: file },
      [`POST /v1/import/history-files/${BATCH}/confirm`]: {
        status: 200,
        body: { ...file, confirmed: { at: "2026-11-20T11:00:00Z" }, derivation: derivation() },
      },
    });
    open(a, `#/money/transactions/rules/history/${BATCH}`);
    await screen.findByRole("heading", { level: 1, name: "Перевірка розпізнавання" });
    fireEvent.click(screen.getByRole("button", { name: "Підтвердити і вивести правила" }));
    const link = await screen.findByRole("link", { name: "Пропозиції правил" });
    expect(link.getAttribute("href")).toBe("#/money/transactions/rules/suggestions");
    expect(screen.getByRole("link", { name: "До правил категорій" })).toBeTruthy();
  });
});
