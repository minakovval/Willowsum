import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
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
import { importPath } from "../routing/routes.ts";
import { resetNavigationSession } from "../routing/session.ts";
import { ResultStep } from "./ResultStep.tsx";
import { armApply } from "./applyIntent.ts";

/**
 * IMP-08@PoC c) (wave 2, row 138) — the step «Результат» of the import wizard, S-174 (canvas PocMoneyImport3 and the «Тексти»
 * board PocMoneyImport3Texts), on the import-sessions routes: `GET …/import/batches/{id}`, `POST …/apply` (IMP-01, IMP-05
 * FR 11, IMP-04 FR 7), `GET …/result` (#673), `POST …/rollback` (IMP-04 FR 8, #666). Synthetic batches and rows only.
 */
const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, "import.css"), "utf8");
const sources = ["ResultStep.tsx", "resultModel.ts", "resultApi.ts", "useResultStep.ts"].map((f) =>
  readFileSync(join(dir, f), "utf8"),
);

const BATCH = "00000000-0000-4000-8000-0000000000b1";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const F2 = "00000000-0000-4000-8000-0000000000f2";
const NAME1 = "privat-oct-2026.xls";
const NAME2 = "mono-oct-2026.csv";

const FUTURE = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

const batchOf = (state: string, over: Record<string, unknown> = {}) => ({
  id: BATCH,
  name: null,
  state,
  version: 3,
  createdAt: "2026-11-02T10:00:00Z",
  lastActionAt: "2026-11-02T10:00:00Z",
  applying: false,
  rollbackUntil: state === "applied" ? FUTURE : null,
  files: { accepted: 2, rejected: 0 },
  ...over,
});
const detail = (state: string) => ({
  ...batchOf(state),
  fileList: [F1, F2].map((id, i) => ({
    id,
    position: i + 1,
    fileName: i === 0 ? NAME1 : NAME2,
    status: "accepted",
    format: "csv",
    sizeBytes: 214_000,
    rejectionCode: null,
    createdAt: "2026-11-02T10:00:00Z",
    rejection: null,
  })),
});
const COUNTS = {
  import: 170,
  repeat: 2,
  merge: 3,
  "possible-duplicate": 1,
  replace: 3,
  duplicate: 4,
  "already-imported": 3,
};
const resultOf = (state = "applied", over: Record<string, unknown> = {}) => ({
  batch: batchOf(state),
  result: { counts: COUNTS },
  appliedAt: "2026-11-02T11:00:00Z",
  followUp:
    state === "rolled-back"
      ? null
      : { cardPaymentTransfers: 0, transferProposals: { count: 4, more: false }, uncategorized: 9 },
  ...over,
});
const applied = (first = true) => ({
  batch: batchOf("applied"),
  result: { counts: COUNTS },
  appliedAt: "2026-11-02T11:00:00Z",
  first,
});

type Handlers = Record<string, (c: Call, u: URL) => Reply | Promise<Reply>>;
/** A batch that is parsed and reviewed (not applied yet); `over` replaces any route. */
function api(over: Handlers = {}, state = "needs-review") {
  return fakeApi({
    [`GET /v1/import/batches/${BATCH}`]: () => ({ status: 200, body: detail(state) }),
    [`POST /v1/import/batches/${BATCH}/apply`]: () => ({ status: 200, body: applied() }),
    [`GET /v1/import/batches/${BATCH}/result`]: () => ({ status: 200, body: resultOf() }),
    ...over,
  });
}
const at = `#${importPath(BATCH, "result")}`;
const posts = (calls: Call[], suffix: string) =>
  calls.filter((c) => c.method === "POST" && c.path.endsWith(suffix));
const refused = (rows: { path: string; issue: string }[]): Reply => ({
  status: 422,
  body: {
    type: "urn:willowsum:problem:import_rows_refused",
    title: "IMPORT_ROWS_REFUSED",
    status: 422,
    code: "IMPORT_ROWS_REFUSED",
    supportId: SUPPORT_ID,
    errors: rows.map((r) => ({ in: "path", ...r })),
  },
  headers: { "content-type": "application/problem+json" },
});

beforeEach(() => {
  armApply(BATCH);
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
});

describe("IMP-08@PoC FR 11, AC7 — the outcome of the apply", () => {
  it("IMP-08@PoC AC7: arriving applies the reviewed batch once, then shows created, replaced and skipped rows, the pairs and the rows without a category", async () => {
    const { client, calls } = api();
    renderAt(at, client, { strict: true });
    expect(await screen.findByRole("heading", { name: "Імпорт завершено" })).toBeTruthy();
    // The apply is sent once, even where the page mounts twice, and the result is read after it.
    expect(posts(calls, "/apply")).toHaveLength(1);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain(`GET /v1/import/batches/${BATCH}/result`);
    const tiles = screen.getByRole("list", { name: "Підсумок імпорту" });
    const tile = (label: string) => within(tiles).getByText(label).parentElement!.textContent;
    expect(tile("Створено")).toContain("176");
    expect(tile("Замінено")).toContain("3");
    expect(tile("Пропущено дублів")).toContain("7");
    expect(plain(screen.getByText("2 файли").textContent)).toBe("2 файли");
    expect(screen.getByText("4 пари переказів знайдено")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Пари · 4" }).getAttribute("href")).toBe(
      "#/money/transactions/pairs",
    );
    expect(screen.getByText("9 транзакцій без категорії")).toBeTruthy();
    expect(screen.getByRole("link", { name: "До розбору" }).getAttribute("href")).toBe(
      "#/money/transactions/review",
    );
    // The batch has no card payments recorded as transfers yet (a later part of IMP-03): the line is not shown.
    expect(screen.queryByText(/на картку/)).toBeNull();
  });

  it("IMP-08@PoC FR 12, AC7: the step confirms no pair and no category — the counts and links only", async () => {
    const { client } = api();
    renderAt(at, client);
    await screen.findByRole("heading", { name: "Імпорт завершено" });
    const names = screen
      .getAllByRole("button")
      .filter((b) => !b.closest("ol") && b.textContent !== "")
      .map((b) => plain(b.textContent));
    expect(names).toEqual(["Відкотити партію"]);
    expect(screen.queryByRole("button", { name: /Підтвердити|Відхилити|Об'єднати/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Імпортувати ще" }).getAttribute("href")).toBe("#/import");
    expect(screen.getByRole("link", { name: "До транзакцій" }).getAttribute("href")).toBe(
      "#/money/transactions",
    );
  });

  it("IMP-08@PoC FR 11: the card payments recorded as transfers are shown when there are some, in their plural form", async () => {
    const { client } = api({
      [`GET /v1/import/batches/${BATCH}/result`]: () => ({
        status: 200,
        body: resultOf("applied", {
          followUp: {
            cardPaymentTransfers: 2,
            transferProposals: { count: 1, more: false },
            uncategorized: 1,
          },
        }),
      }),
    });
    renderAt(at, client);
    expect(await screen.findByText("2 платежі на картку записано як перекази")).toBeTruthy();
    expect(screen.getByText("1 пара переказів знайдено")).toBeTruthy();
    expect(screen.getByText("1 транзакція без категорії")).toBeTruthy();
  });

  it("IMP-08@PoC FR 11: no pairs and nothing without a category — the lines say 0 and offer no link; a capped read says «понад»", async () => {
    const { client } = api({
      [`GET /v1/import/batches/${BATCH}/result`]: () => ({
        status: 200,
        body: resultOf("applied", {
          followUp: {
            cardPaymentTransfers: 0,
            transferProposals: { count: 0, more: false },
            uncategorized: 0,
          },
        }),
      }),
    });
    const { unmount } = renderAt(at, client);
    expect(await screen.findByText("0 пар переказів знайдено")).toBeTruthy();
    expect(screen.getByText("0 транзакцій без категорії")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Пари/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "До розбору" })).toBeNull();
    unmount();

    armApply(BATCH);
    const capped = api({
      [`GET /v1/import/batches/${BATCH}/result`]: () => ({
        status: 200,
        body: resultOf("applied", {
          followUp: {
            cardPaymentTransfers: 0,
            transferProposals: { count: 500, more: true },
            uncategorized: 12,
          },
        }),
      }),
    });
    renderAt(at, capped.client);
    expect(await screen.findByText("Знайдено понад 500 пар переказів")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Пари · 500+" })).toBeTruthy();
  });

  it("IMP-08@PoC FR 11: created counts the rows written as new ones, merged with a manual one or flagged «Можливий дубль»; skipped the two kinds of duplicate", async () => {
    const { client } = api({
      [`GET /v1/import/batches/${BATCH}/result`]: () => ({
        status: 200,
        body: resultOf("applied", {
          result: {
            counts: {
              import: 5,
              repeat: 1,
              merge: 2,
              "possible-duplicate": 3,
              replace: 4,
              duplicate: 6,
              "already-imported": 7,
              excluded: 9,
            },
          },
        }),
      }),
    });
    renderAt(at, client);
    const tiles = await screen.findByRole("list", { name: "Підсумок імпорту" });
    const n = (label: string) =>
      within(tiles).getByText(label).parentElement!.querySelector("b")!.textContent;
    expect([n("Створено"), n("Замінено"), n("Пропущено дублів")]).toEqual(["11", "4", "13"]);
  });
});

describe("IMP-04@PoC FR 7 — a batch applied before is not applied again", () => {
  it("IMP-04@PoC FR 7, IMP-08@PoC FR 1: the same address after a reload shows the stored result and sends no apply", async () => {
    const { client, calls } = api({}, "applied");
    renderAt(at, client);
    expect(await screen.findByRole("heading", { name: "Імпорт завершено" })).toBeTruthy();
    expect(posts(calls, "/apply")).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toMatch(/Партію вже застосовано .+ Ось її результат\./);
    expect(screen.getByText("Створено")).toBeTruthy();
  });

  it("IMP-04@PoC FR 7: an apply that returns the stored result (first: false) says the batch was applied already", async () => {
    const { client, calls } = api({
      [`POST /v1/import/batches/${BATCH}/apply`]: () => ({ status: 200, body: applied(false) }),
    });
    renderAt(at, client);
    expect(await screen.findByText(/Партію вже застосовано/)).toBeTruthy();
    expect(posts(calls, "/apply")).toHaveLength(1);
  });

  it("IMP-08@PoC FR 1: the wizard's steps show «Результат» as the current one", async () => {
    const { client } = api();
    renderAt(at, client);
    await screen.findByRole("heading", { name: "Імпорт завершено" });
    const steps = screen.getByRole("list", { name: "Кроки імпорту" });
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain("Результат");
  });
});

describe("IMP-08@PoC FR 16 — loading, applying, errors", () => {
  it("IMP-08@PoC FR 16: while the apply runs the step says so and is busy; the outcome follows", async () => {
    let release: (r: Reply) => void = () => undefined;
    const gate = new Promise<Reply>((r) => (release = r));
    const { client } = api({ [`POST /v1/import/batches/${BATCH}/apply`]: () => gate });
    const { container } = renderAt(at, client);
    expect(await screen.findByRole("heading", { name: "Застосовуємо партію…" })).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("Створено")).toBeNull();
    release({ status: 200, body: applied() });
    expect(await screen.findByRole("heading", { name: "Імпорт завершено" })).toBeTruthy();
  });

  it("IMP-08@PoC FR 16: a failed apply shows the API's code and «Спробувати ще раз»; the retry applies and shows the outcome", async () => {
    let n = 0;
    const { client, calls } = api({
      [`POST /v1/import/batches/${BATCH}/apply`]: () =>
        ++n === 1 ? problem(500, "INTERNAL") : { status: 200, body: applied() },
    });
    renderAt(at, client);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Не вдалося застосувати партію.");
    expect(alert.textContent).toContain(SUPPORT_ID);
    expect(screen.getByText("Повторна спроба безпечна: партію буде застосовано лише один раз.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByRole("heading", { name: "Імпорт завершено" })).toBeTruthy();
    expect(posts(calls, "/apply")).toHaveLength(2);
  });

  it("IMP-08@PoC FR 16: a lost connection on the apply says so and offers the retry", async () => {
    let n = 0;
    const { client } = api({
      [`POST /v1/import/batches/${BATCH}/apply`]: () =>
        ++n === 1 ? "network" : { status: 200, body: applied() },
    });
    renderAt(at, client);
    expect((await screen.findByRole("alert")).textContent).toContain("Перевірте з'єднання.");
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByRole("heading", { name: "Імпорт завершено" })).toBeTruthy();
  });

  it("IMP-08@PoC FR 16: the apply went through but the result cannot be read — the retry reads it and does not apply again", async () => {
    let reads = 0;
    const { client, calls } = api({
      [`GET /v1/import/batches/${BATCH}`]: () => ({
        status: 200,
        body: detail(reads === 0 ? "needs-review" : "applied"),
      }),
      [`GET /v1/import/batches/${BATCH}/result`]: () =>
        ++reads === 1 ? problem(500, "INTERNAL") : { status: 200, body: resultOf() },
    });
    renderAt(at, client);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Партію застосовано, але не вдалося завантажити її результат.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByRole("heading", { name: "Імпорт завершено" })).toBeTruthy();
    expect(posts(calls, "/apply")).toHaveLength(1);
  });

  it("IMP-08@PoC FR 16: the batch cannot be read — an error with the code and a retry; an unknown batch is «не знайдено»", async () => {
    const { client } = api({ [`GET /v1/import/batches/${BATCH}`]: () => problem(500, "INTERNAL") });
    const first = renderAt(at, client);
    expect((await screen.findByRole("alert")).textContent).toContain("Не вдалося завантажити імпорт.");
    first.unmount();
    const gone = api({ [`GET /v1/import/batches/${BATCH}`]: () => problem(404, "NOT_FOUND") });
    renderAt(at, gone.client);
    expect(await screen.findByText("Імпорт не знайдено")).toBeTruthy();
    expect(posts(gone.calls, "/apply")).toHaveLength(0);
  });

  it("IMP-08@PoC FR 16: a cancelled batch has no result, and one not read yet leads back to the files; neither is applied", async () => {
    const cancelled = api({}, "cancelled");
    const a = renderAt(at, cancelled.client);
    expect(await screen.findByText("Імпорт скасовано")).toBeTruthy();
    expect(posts(cancelled.calls, "/apply")).toHaveLength(0);
    a.unmount();
    const early = api({}, "uploaded");
    renderAt(at, early.client);
    expect(await screen.findByText("Партію ще не розібрано")).toBeTruthy();
    expect(screen.getByRole("link", { name: "До файлів" }).getAttribute("href")).toBe(`#/import/${BATCH}`);
    expect(posts(early.calls, "/apply")).toHaveLength(0);
  });

  it("IMP-05@PoC FR 11: a batch that is not ready is refused with its code and leads back to the review", async () => {
    const { client } = api({
      [`POST /v1/import/batches/${BATCH}/apply`]: () => problem(409, "IMPORT_NOT_READY"),
    });
    renderAt(at, client);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("дайте відповіді на питання на кроці перевірки");
    expect(alert.textContent).toContain(SUPPORT_ID);
    expect(screen.getByRole("link", { name: "Назад до перевірки" }).getAttribute("href")).toBe(
      `#/import/${BATCH}/review`,
    );
    expect(screen.queryByText(/Повторна спроба безпечна/)).toBeNull();
  });

  it("IMP-08@PoC FR 16: a batch too large, an unsupported one, a closed account and a changed state each have their own words", async () => {
    const cases: [string, number, RegExp][] = [
      ["IMPORT_PLAN_TOO_LARGE", 422, /забагато транзакцій для одного застосування/],
      ["IMPORT_APPLY_UNSUPPORTED", 409, /їй потрібен крок, якого ще немає/],
      ["ACCOUNT_CLOSED", 409, /Рахунок партії закрито/],
      ["BATCH_STATE_CONFLICT", 409, /Стан партії змінився/],
    ];
    for (const [code, status, text] of cases) {
      armApply(BATCH);
      const { client } = api({ [`POST /v1/import/batches/${BATCH}/apply`]: () => problem(status, code) });
      const view = renderAt(at, client);
      expect((await screen.findByRole("alert")).textContent).toMatch(text);
      if (code === "ACCOUNT_CLOSED")
        expect(screen.getByRole("link", { name: "До файлів" }).getAttribute("href")).toBe(
          `#/import/${BATCH}`,
        );
      view.unmount();
    }
  });
});

describe("IMP-05@PoC FR 11, IMP-01@PoC FR 11 — a refused apply (all rows or none)", () => {
  const rows = [
    { path: `files[${F1}].rows[14]`, issue: "unreadable" },
    { path: `files[${F2}].rows[3]`, issue: "too-precise" },
    { path: `files[${F2}]`, issue: "account" },
    { path: "batchId", issue: "currency" },
    { path: `files[${F1}].rows[20]`, issue: "some-new-issue" },
  ];

  it("IMP-05@PoC FR 11: IMPORT_ROWS_REFUSED lists the rows with the file, the number and the reason, nothing is shown as applied", async () => {
    const { client } = api({ [`POST /v1/import/batches/${BATCH}/apply`]: () => refused(rows) });
    renderAt(at, client);
    expect(await screen.findByRole("heading", { name: "Партію не застосовано" })).toBeTruthy();
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("не записано нічого");
    expect(banner.textContent).toContain(SUPPORT_ID);
    expect(screen.getByRole("heading", { name: "Рядки з проблемами · 5" })).toBeTruthy();
    const items = screen.getAllByRole("listitem").filter((li) => li.classList.contains("imp-result-issue"));
    expect(items.map((li) => plain(li.textContent))).toEqual([
      `${NAME1} · рядок 14Не вдалося прочитати дату або суму.`,
      `${NAME2} · рядок 3У сумі більше знаків після коми, ніж дозволяє валюта.`,
      `${NAME2}Рядок належить іншому рахунку.`,
      "Уся партіяУ рядка немає валюти.",
      `${NAME1} · рядок 20Причину названо в коді рушія. (some-new-issue)`,
    ]);
    expect(screen.queryByText("Створено")).toBeNull();
    expect(screen.queryByRole("button", { name: "Відкотити партію" })).toBeNull();
  });

  it("IMP-05@PoC FR 11: the way back is the review; the retry applies again and shows the outcome when it goes through", async () => {
    let n = 0;
    const { client, calls } = api({
      [`POST /v1/import/batches/${BATCH}/apply`]: () =>
        ++n === 1 ? refused(rows) : { status: 200, body: applied() },
    });
    renderAt(at, client);
    await screen.findByRole("heading", { name: "Партію не застосовано" });
    expect(screen.getByRole("link", { name: "Назад до перевірки" }).getAttribute("href")).toBe(
      `#/import/${BATCH}/review`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByRole("heading", { name: "Імпорт завершено" })).toBeTruthy();
    expect(posts(calls, "/apply")).toHaveLength(2);
  });

  it("IMP-08@PoC FR 16: a long list of refused rows is shown 50 at a time", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      path: `files[${F1}].rows[${i + 1}]`,
      issue: "unreadable",
    }));
    const { client } = api({ [`POST /v1/import/batches/${BATCH}/apply`]: () => refused(many) });
    renderAt(at, client);
    await screen.findByRole("heading", { name: "Рядки з проблемами · 120" });
    const shown = () => document.querySelectorAll(".imp-result-issue").length;
    expect(shown()).toBe(50);
    expect(screen.getByText("Показано 50 з 120")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Показати ще" }));
    expect(shown()).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: "Показати ще" }));
    expect(shown()).toBe(120);
    expect(screen.queryByRole("button", { name: "Показати ще" })).toBeNull();
  });
});

describe("IMP-04@PoC FR 8, AC7, AC8 — «Відкотити»", () => {
  it("IMP-04@PoC FR 8: the line names the 7 days and the moment; «Відкотити партію» opens a dialog that keeps the changed ones by default", async () => {
    const { client } = api();
    renderAt(at, client);
    await screen.findByRole("heading", { name: "Імпорт завершено" });
    expect(screen.getByText(/Партію можна відкотити протягом 7 днів\. Відкотити можна до /)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Відкотити партію" }));
    const dialog = await screen.findByRole("dialog", { name: "Відкотити партію?" });
    expect(within(dialog).getByRole("radio", { name: "Залишити змінені" })).toHaveProperty("checked", true);
    expect(within(dialog).getByRole("radio", { name: "Відкотити все" })).toHaveProperty("checked", false);
  });

  it("IMP-04@PoC AC7: «Залишити змінені» sends the mode, then the result shows the batch rolled back with what was rolled back and kept", async () => {
    let rolled = false;
    const { client, calls } = api({
      [`POST /v1/import/batches/${BATCH}/rollback`]: () => {
        rolled = true;
        return {
          status: 200,
          body: {
            batch: batchOf("rolled-back"),
            rollback: {
              mode: "keep-changed",
              counts: { rolledBack: 175, kept: 1, transfers: 2, restored: 3 },
              kept: [],
              rolledBackAt: "2026-11-03T10:00:00Z",
            },
            first: true,
          },
        };
      },
      [`GET /v1/import/batches/${BATCH}/result`]: () => ({
        status: 200,
        body: resultOf(rolled ? "rolled-back" : "applied"),
      }),
    });
    renderAt(at, client);
    await screen.findByRole("heading", { name: "Імпорт завершено" });
    fireEvent.click(screen.getByRole("button", { name: "Відкотити партію" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Відкотити" }));
    expect(await screen.findByRole("heading", { name: "Партію відкочено" })).toBeTruthy();
    expect(posts(calls, "/rollback").map((c) => c.body)).toEqual([{ mode: "keep-changed" }]);
    expect(screen.getByText("Відкочено транзакцій: 175")).toBeTruthy();
    expect(screen.getByText("Залишено змінених: 1")).toBeTruthy();
    expect(screen.getByText("Залишено як сторони переказів: 2")).toBeTruthy();
    expect(screen.getByText("Повернуто злитих транзакцій: 3")).toBeTruthy();
    // A rolled-back batch has nothing left to do: no tiles of old counts, no pairs, no second rollback.
    expect(screen.queryByText("Створено")).toBeNull();
    expect(screen.queryByRole("button", { name: "Відкотити партію" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Пари/ })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("IMP-04@PoC FR 8: «Відкотити все» sends the mode all", async () => {
    const { client, calls } = api({
      [`POST /v1/import/batches/${BATCH}/rollback`]: () => ({
        status: 200,
        body: {
          batch: batchOf("rolled-back"),
          rollback: {
            mode: "all",
            counts: { rolledBack: 180, kept: 0, transfers: 0, restored: 0 },
            kept: [],
            rolledBackAt: "2026-11-03T10:00:00Z",
          },
          first: true,
        },
      }),
    });
    renderAt(at, client);
    await screen.findByRole("heading", { name: "Імпорт завершено" });
    fireEvent.click(screen.getByRole("button", { name: "Відкотити партію" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Відкотити все" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Відкотити" }));
    await waitFor(() => expect(posts(calls, "/rollback")).toHaveLength(1));
    expect(posts(calls, "/rollback")[0]!.body).toEqual({ mode: "all" });
  });

  it("IMP-04@PoC AC8: after the 7 days the step says «Строк відкату минув» and offers no rollback; the server's refusal reads the same in the dialog", async () => {
    const expired = api({
      [`GET /v1/import/batches/${BATCH}/result`]: () => ({
        status: 200,
        body: resultOf("applied", { batch: batchOf("applied", { rollbackUntil: PAST }) }),
      }),
    });
    const a = renderAt(at, expired.client);
    expect(await screen.findByText("Строк відкату минув.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Відкотити партію" })).toBeNull();
    a.unmount();

    armApply(BATCH);
    const { client } = api({
      [`POST /v1/import/batches/${BATCH}/rollback`]: () => problem(409, "IMPORT_ROLLBACK_EXPIRED"),
    });
    renderAt(at, client);
    await screen.findByRole("heading", { name: "Імпорт завершено" });
    fireEvent.click(screen.getByRole("button", { name: "Відкотити партію" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Відкотити" }));
    expect(await within(dialog).findByText(/Помилка\. Строк відкату минув\./)).toBeTruthy();
    // The dialog stays open, the batch stays applied.
    expect(screen.getByText("Створено")).toBeTruthy();
  });

  it("IMP-04@PoC FR 8: Escape closes the dialog without a request", async () => {
    const { client, calls } = api();
    renderAt(at, client);
    await screen.findByRole("heading", { name: "Імпорт завершено" });
    fireEvent.click(screen.getByRole("button", { name: "Відкотити партію" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posts(calls, "/rollback")).toHaveLength(0);
  });

  it("IMP-04@PoC FR 8: a batch opened rolled back shows it as rolled back, with no counts of the old apply", async () => {
    const { client, calls } = api(
      { [`GET /v1/import/batches/${BATCH}/result`]: () => ({ status: 200, body: resultOf("rolled-back") }) },
      "rolled-back",
    );
    renderAt(at, client);
    expect(await screen.findByRole("heading", { name: "Партію відкочено" })).toBeTruthy();
    expect(posts(calls, "/apply")).toHaveLength(0);
    expect(screen.queryByText("Створено")).toBeNull();
    expect(screen.queryByText(/Партію вже застосовано/)).toBeNull();
  });
});

describe("IMP-08@PoC FR 14, FR 15 — keyboard, names, long texts, languages", () => {
  it("IMP-08@PoC FR 14: every action is a link or a button with a name, reachable by Tab; the target size comes from the shared Button", async () => {
    const { client } = api();
    renderAt(at, client);
    await screen.findByRole("heading", { name: "Імпорт завершено" });
    for (const name of ["Пари · 4", "До розбору", "Імпортувати ще", "До транзакцій"])
      expect(screen.getByRole("link", { name }).getAttribute("tabindex")).not.toBe("-1");
    const rollback = screen.getByRole("button", { name: "Відкотити партію" });
    rollback.focus();
    expect(document.activeElement).toBe(rollback);
  });

  it("IMP-08@PoC FR 14: long names and reasons wrap inside their cells and the page does not scroll sideways", () => {
    expect(css).toMatch(/\.imp-result-text[^{]*\{[^}]*overflow-wrap: anywhere/s);
    expect(css).toMatch(/\.imp-result-issue[^{]*\{[^}]*overflow-wrap: anywhere/s);
    expect(css).toMatch(/\.imp-result-tile-n[^{]*\{[^}]*overflow-wrap: anywhere/s);
    expect(css).toMatch(/\.imp-result-tile[^{]*\{[^}]*min-width: 0/s);
    expect(css).not.toMatch(/overflow-x:\s*(scroll|auto)/);
  });

  it("IMP-08@PoC FR 14: the step does no money arithmetic — it adds up whole row counts only and has no amount", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/parseFloat|toFixed|Decimal|formatMoney|Number\(.*amount/);
    }
  });

  it("IMP-08@PoC FR 15: the step reads in English too: the title, the tiles, the lines and the rollback", async () => {
    const { client } = api();
    render(
      <I18nProvider initialLocale="en">
        <AuthApiProvider value={client}>
          <ResultStep batchId={BATCH} />
        </AuthApiProvider>
      </I18nProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Import finished" })).toBeTruthy();
    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.getByText("Duplicates skipped")).toBeTruthy();
    expect(screen.getByText("4 pairs of transfers found")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pairs · 4" })).toBeTruthy();
    expect(screen.getByText("9 transactions without a category")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Roll back the batch" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "To transactions" })).toBeTruthy();
  });
});
