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
import { importPath, resolveRoute } from "../routing/routes.ts";
import { resetNavigationSession } from "../routing/session.ts";
import { takeApplyIntent } from "./applyIntent.ts";
import { ReviewStep } from "./ReviewStep.tsx";
import { POLLING } from "./useImportStep.ts";

/**
 * IMP-08@PoC b) (wave 2, row 137) — the step «Перевірка розпізнавання» of the import wizard, S-171 (canvas PocMoneyImport2,
 * PocMoneyImportMismatch and the «Тексти» board PocMoneyImport2Texts), on the review API of the import-sessions module:
 * `GET …/files/{fileId}/review`, `…/review/rows`, `…/rows`, `…/duplicates`, `POST …/decisions`, `GET …/readiness`, `…/parse`.
 * Synthetic rows and files only. The original of the file next to the rows is the next part of the row and is not tested
 * here; the bank's status of a row is not shown until the parser reads it.
 */
const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, "import.css"), "utf8");

const BATCH = "00000000-0000-4000-8000-0000000000b1";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const F2 = "00000000-0000-4000-8000-0000000000f2";
const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const TX = "00000000-0000-4000-8000-0000000000c1";

type State = "ok" | "needs-review" | "needs-clarification" | "error" | "excluded";
interface Row {
  row: number;
  state: State;
  changed: boolean;
  signUnconfirmed: boolean;
  decision: { action: string; from: "row" | "group" } | null;
  reading: null | { cell: string; readings: { decimal: "," | "."; value: string }[]; chosen: string | null };
  issue: string | null;
  text: string;
  amount: string;
}

const row = (n: number, over: Partial<Row> = {}): Row => ({
  row: n,
  state: "ok",
  changed: false,
  signUnconfirmed: false,
  decision: null,
  reading: null,
  issue: null,
  text: `SILPO ${n}`,
  amount: "-38.10",
  ...over,
});
const ambiguous = (n: number, over: Partial<Row> = {}) =>
  row(n, {
    state: "needs-clarification",
    reading: {
      cell: "1.234",
      readings: [
        { decimal: ".", value: "1.234" },
        { decimal: ",", value: "1234" },
      ],
      chosen: null,
    },
    ...over,
  });

const EVIDENCE = [{ code: "ambiguous-integers", count: 7, of: 40 }];

/** The server of one file: its rows under the decisions the test sends, with the responses of the review API. */
class Server {
  decisions: unknown[] = [];
  flags: {
    code: string;
    severity: "block" | "review";
    difference?: string;
    positive?: number;
    negative?: number;
  }[] = [];
  open = new Set<string>();
  dateOrder = false;
  history: Record<string, unknown> | null = null;
  duplicates: { row: number; kind: string }[] = [];
  afterEarlierFile = false;
  groupAction: string | null = null;
  rows: Row[];
  constructor(rows: Row[]) {
    this.rows = rows;
  }

  counts() {
    const states = { ok: 0, "needs-review": 0, "needs-clarification": 0, error: 0, excluded: 0 };
    for (const r of this.rows) states[r.state] += 1;
    return {
      rows: this.rows.length,
      states,
      changed: this.rows.filter((r) => r.changed).length,
      signUnconfirmed: this.rows.filter((r) => r.signUnconfirmed).length,
    };
  }
  review() {
    const c = this.counts();
    return {
      counts: c,
      signGroup: { rows: c.signUnconfirmed, action: this.groupAction },
      analysis: {
        table: { headerRow: 1, dataRows: c.rows, evidence: [] },
        columns: [],
        dates: null,
        numbers: null,
        sign: null,
        currency: { mode: "file", code: "EUR", evidence: [] },
      },
      encoding: null,
      delimiter: null,
    };
  }
  page(url: URL) {
    const filter = url.searchParams.get("filter");
    const after = Number(url.searchParams.get("cursor") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 25);
    const all = this.rows.filter(
      (r) =>
        r.row > after &&
        (filter === null ||
          (filter === "changed"
            ? r.changed
            : filter === "sign-unconfirmed"
              ? r.signUnconfirmed
              : r.state === filter)),
    );
    return { page: all.slice(0, limit), more: all.length > limit };
  }
  reviewRows(url: URL): Reply {
    const { page, more } = this.page(url);
    return {
      status: 200,
      body: {
        items: page.map((r) => ({
          row: r.row,
          state: r.state,
          decision: r.decision,
          changed: r.changed,
          signUnconfirmed: r.signUnconfirmed,
          sign: r.signUnconfirmed ? { basis: "card", confidence: 0.6, confirmed: false } : null,
          reading: r.reading ? { ...r.reading, evidence: EVIDENCE } : null,
          issue: r.issue,
          bankStatus: null,
        })),
        nextCursor: more ? String(page.at(-1)!.row) : null,
      },
    };
  }
  fileRows(url: URL): Reply {
    const after = Number(url.searchParams.get("cursor") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 25);
    const all = this.rows.filter((r) => r.row > after);
    const page = all.slice(0, limit);
    return {
      status: 200,
      body: {
        items: page.map((r) => ({
          row: r.row,
          date: `2026-10-${String((r.row % 28) + 1).padStart(2, "0")}`,
          valueDate: null,
          currency: "EUR",
          legs: [{ amount: r.amount, currency: "EUR" }],
          fee: null,
          balance: null,
          original: null,
          rate: null,
          description: r.text,
          counterparty: r.text,
          reference: null,
          currencyMark: null,
          flags: [],
        })),
        nextCursor: all.length > limit ? String(page.at(-1)!.row) : null,
      },
    };
  }
  dupes(): Reply {
    return {
      status: 200,
      body: {
        items: this.duplicates.map((d) => ({
          row: d.row,
          occurrence: 1,
          kind: d.kind,
          transactionIds: d.kind === "repeat" ? [] : [TX],
          batchId: null,
          merge: false,
        })),
        nextCursor: null,
        accountId: ACCOUNT,
        afterEarlierFile: this.afterEarlierFile,
      },
    };
  }
  readiness(): Reply {
    const refusals: unknown[] = [];
    const msg = (uk: string, en: string) => ({ uk, en });
    const questions = this.rows.filter((r) => r.state === "needs-clarification").map((r) => r.row);
    if (questions.length > 0 || this.dateOrder)
      refusals.push({
        code: "clarifications",
        message: msg("Потрібні уточнення", "Clarifications needed"),
        files: [{ fileId: F1, rows: questions, count: questions.length, dateOrder: this.dateOrder }],
      });
    const review = this.rows.filter((r) => r.state === "needs-review").map((r) => r.row);
    if (review.length > 0)
      refusals.push({
        code: "review-rows",
        message: msg("Потрібен перегляд рядків", "Rows need review"),
        files: [{ fileId: F1, rows: review, count: review.length }],
      });
    const open = this.flags.filter((f) => this.open.has(f.code));
    if (open.length > 0)
      refusals.push({
        code: "flags",
        message: msg("Не підтверджені позначки", "Flags not confirmed"),
        files: [
          {
            fileId: F1,
            flags: open.map((f) =>
              f.code === "checksum-mismatch" ? { ...f, choices: ["update", "keep"] } : f,
            ),
          },
        ],
      });
    return {
      status: 200,
      body: {
        ready: refusals.length === 0,
        refusals,
        codes: refusals.map((r) => (r as { code: string }).code),
        files: [{ fileId: F1, balance: null, history: this.history }],
      },
    };
  }
  decide(body: { decisions: Record<string, unknown>[] }): Reply {
    for (const d of body.decisions) {
      this.decisions.push(d);
      const target = this.rows.find((r) => r.row === d["row"]);
      if (d["kind"] === "row" && target) {
        const action = d["action"];
        if (action === "exclude")
          Object.assign(target, { state: "excluded", decision: { action, from: "row" } });
        if (action === "include") Object.assign(target, { state: "ok", decision: { action, from: "row" } });
        if (action === "accept") Object.assign(target, { state: "ok", decision: { action, from: "row" } });
        if (action === "flip-sign")
          Object.assign(target, { state: "ok", changed: true, decision: { action, from: "row" } });
      }
      if (d["kind"] === "reading" && target) {
        Object.assign(target, { state: "ok", changed: true });
        target.reading!.chosen = d["value"] as string;
      }
      if (d["kind"] === "group") {
        this.groupAction = d["action"] as string;
        for (const r of this.rows.filter((x) => x.signUnconfirmed && x.state === "needs-review")) {
          r.state = "ok";
          r.decision = { action: d["action"] as string, from: "group" };
          if (d["action"] === "flip-sign") r.changed = true;
        }
        this.open.delete("card-sign");
      }
      if (d["kind"] === "flag") this.open.delete(d["code"] as string);
      if (d["kind"] === "balance") this.open.delete("checksum-mismatch");
      if (d["kind"] === "date-order") this.dateOrder = false;
    }
    return { status: 200, body: { version: 2, decisions: [], nextCursor: null } };
  }
}

const fileEntry = (id: string, name: string) => ({
  id,
  position: 1,
  fileName: name,
  status: "accepted",
  format: "csv",
  sizeBytes: 214_000,
  rejectionCode: null,
  createdAt: "2026-11-02T10:00:00Z",
  rejection: null,
});
const batchOf = (state = "parsed") => ({
  id: BATCH,
  name: null,
  state,
  version: 1,
  createdAt: "2026-11-02T10:00:00Z",
  lastActionAt: "2026-11-02T10:00:00Z",
  applying: false,
  files: { accepted: 1, rejected: 0 },
});

interface Options {
  servers?: Record<string, Server>;
  names?: Record<string, string>;
  recipe?: "match" | "changed" | null;
  over?: Record<string, (call: Call, url: URL) => Reply | Promise<Reply>>;
  state?: string;
}

/** A fake API for the files of the test; every request is recorded by `fakeApi`. */
function api(server: Server | Record<string, Server>, o: Options = {}) {
  const servers: Record<string, Server> = server instanceof Server ? { [F1]: server } : server;
  const ids = Object.keys(servers);
  const names = o.names ?? { [F1]: "privat-oct-2026.xls", [F2]: "mono-oct-2026.csv" };
  const flagsOf = (s: Server) => s.flags.map((f) => ({ ...f }));
  const handlers: Record<string, (c: Call, u: URL) => Reply | Promise<Reply>> = {
    [`GET /v1/import/batches/${BATCH}`]: () => ({
      status: 200,
      body: {
        ...batchOf(o.state),
        files: { accepted: ids.length, rejected: 0 },
        fileList: ids.map((id) => fileEntry(id, names[id]!)),
      },
    }),
    [`GET /v1/import/batches/${BATCH}/parse`]: () => ({
      status: 200,
      body: {
        batch: batchOf(o.state),
        progress: { pending: 0, parsed: ids.length, failed: 0 },
        files: ids.map((id) => ({
          fileId: id,
          position: 1,
          state: "parsed",
          refusal: null,
          recipe: o.recipe ? { id: "00000000-0000-4000-8000-0000000000a1", format: o.recipe } : null,
          accountId: ACCOUNT,
          engineVersion: "1",
          rowCount: servers[id]!.rows.length,
          checks: { currency: "EUR", flags: flagsOf(servers[id]!) },
          history: null,
          previousFileId: null,
        })),
      },
    }),
    [`GET /v1/import/batches/${BATCH}/readiness`]: () => servers[F1]!.readiness(),
    [`POST /v1/import/batches/${BATCH}/decisions`]: (c) =>
      servers[F1]!.decide(c.body as { decisions: Record<string, unknown>[] }),
  };
  for (const id of ids) {
    const s = servers[id]!;
    const base = `/v1/import/batches/${BATCH}/files/${id}`;
    handlers[`GET ${base}/review`] = () => ({ status: 200, body: s.review() });
    handlers[`GET ${base}/review/rows`] = (_c, u) => s.reviewRows(u);
    handlers[`GET ${base}/rows`] = (_c, u) => s.fileRows(u);
    handlers[`GET ${base}/duplicates`] = () => s.dupes();
  }
  Object.assign(handlers, o.over ?? {});
  return fakeApi(handlers);
}

const at = (batch = BATCH) => `#${importPath(batch, "review")}`;
const decisionsOf = (calls: Call[]) =>
  calls.filter((c) => c.method === "POST" && c.path.endsWith("/decisions")).map((c) => c.body);
const applyButton = () => screen.getByText("Застосувати").closest("a, button") as HTMLElement;
const isDisabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true";
/** A button by its name with the no-break spaces of numbers read as plain spaces. */
const named = (name: string) => screen.getByRole("button", { name: (n) => plain(n) === name });
const lineOf = (text: string | RegExp) => screen.getByText(text).closest("li") as HTMLElement;

/** A batch of 200 rows: 8 questions, 4 rows with an unconfirmed sign, 3 rows with an error (12 flagged, 3 rejected). */
function longServer(): Server {
  const rows = Array.from({ length: 200 }, (_, i) => row(i + 1));
  for (const n of [3, 9, 15, 21, 27, 33, 39, 45]) rows[n - 1] = ambiguous(n);
  for (const n of [50, 60, 70, 80]) rows[n - 1] = row(n, { state: "needs-review", signUnconfirmed: true });
  for (const n of [100, 110, 120]) rows[n - 1] = row(n, { state: "error", issue: "unreadable" });
  return new Server(rows);
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  POLLING.ms = 5;
});

describe("IMP-08@PoC — the address of the step", () => {
  it("IMP-08@PoC FR 1: the step has its own address and «Результат» stays the next one", () => {
    expect(resolveRoute(`/import/${BATCH}/review`)).toEqual({
      kind: "importWizard",
      batchId: BATCH,
      step: "review",
    });
    expect(resolveRoute(`/import/${BATCH}/result`)).toEqual({
      kind: "importWizard",
      batchId: BATCH,
      step: "result",
    });
  });

  it("IMP-08@PoC AC8: the same address after a reload opens the same step with the panel on the question tab", async () => {
    const { client, calls } = api(longServer());
    renderAt(at(), client);
    expect(await screen.findByRole("heading", { name: "Перевірка розпізнавання" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Як ми прочитали" })).toBeTruthy();
    expect(await screen.findByRole("radio", { name: "Питання · 15" })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: "Усі рядки" })).toHaveProperty("checked", false);
    // Nothing was created or parsed again on the way in.
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    const steps = screen.getByRole("list", { name: "Кроки імпорту" });
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain("Перевірка");
  });
});

describe("IMP-08@PoC AC3, FR 5 — the counters of the batch", () => {
  it("IMP-08@PoC AC3: a batch of 200 rows with 12 flagged and 3 rejected shows 200 / 12 / 3", async () => {
    const { client } = api(longServer());
    renderAt(at(), client);
    const counters = await screen.findByRole("list", { name: "Підсумок розпізнавання" });
    const text = plain(counters.textContent);
    expect(text).toContain("200 розібрано");
    expect(text).toContain("12 позначено");
    expect(text).toContain("3 відхилено");
  });

  it("IMP-08@PoC FR 5: the filter lists a state or a mark with its count; the rows come from the API under that filter", async () => {
    const server = longServer();
    server.rows[4] = row(5, { changed: true });
    const { client, calls } = api(server);
    renderAt(at(), client);
    fireEvent.click(await screen.findByRole("radio", { name: "Усі рядки" }));
    const filter = await screen.findByRole("combobox", { name: "Показати" });
    const options = within(filter)
      .getAllByRole("option")
      .map((o) => plain(o.textContent));
    expect(options).toContain("Усі рядки · 200");
    expect(options).toContain("Потребує уточнення · 8");
    expect(options).toContain("Знак не підтверджено · 4");
    expect(options).toContain("Змінено · 1");
    fireEvent.change(filter, { target: { value: "changed" } });
    await screen.findByText("SILPO 5");
    expect(screen.queryByText("SILPO 6")).toBeNull();
    expect(calls.some((c) => c.path.endsWith("/review/rows") && c.path.includes(F1))).toBe(true);
  });
});

describe("IMP-08@PoC FR 6, AC6 — problem rows are marked by word and marker", () => {
  it("IMP-08@PoC FR 6: the question tab lists clarifications, then rows to review, then errors, each with its word", async () => {
    const { client } = api(longServer());
    renderAt(at(), client);
    const list = await screen.findByRole("list", { name: "Рядки виписки" });
    const items = Array.from(list.querySelectorAll<HTMLElement>(":scope > li"));
    expect(items).toHaveLength(15);
    expect(within(items[0]!).getByText("Уточнення")).toBeTruthy();
    expect(within(items[8]!).getByText("Перегляд")).toBeTruthy();
    expect(within(items[12]!).getByText("Помилка")).toBeTruthy();
    // The values of a row are the file's: date, text and the amount with its currency.
    expect(plain(items[0]!.textContent)).toContain("SILPO 3");
    expect(plain(items[0]!.textContent)).toContain("−38,10 €");
  });

  it("IMP-08@PoC AC6: a row the user changed is marked «Змінено» in the list", async () => {
    const server = longServer();
    const { client } = api(server);
    renderAt(at(), client);
    const row50 = await screen.findByRole("button", { name: /SILPO 50/ });
    fireEvent.click(row50);
    fireEvent.click(within(lineOf("SILPO 50")).getByRole("button", { name: "Перевернути знак" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Усі рядки" }));
    const line = await waitFor(() => lineOf("SILPO 50"));
    expect(within(line).getByText("Змінено")).toBeTruthy();
    expect(plain(screen.getByRole("list", { name: "Підсумок розпізнавання" }).textContent)).toContain(
      "1 змінено",
    );
  });

  it("IMP-08@PoC FR 8: «Виключити» and «Включити» answer for one row and never touch a recipe", async () => {
    const server = new Server([row(1), ambiguous(2), row(3)]);
    const { client, calls } = api(server);
    renderAt(at(), client);
    fireEvent.click(await screen.findByRole("button", { name: /SILPO 2/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Виключити" }));
    await waitFor(() => expect(screen.getByText("Питань немає")).toBeTruthy());
    expect(decisionsOf(calls)).toEqual([
      { decisions: [{ kind: "row", fileId: F1, row: 2, action: "exclude" }] },
    ]);
    fireEvent.click(screen.getByRole("radio", { name: "Усі рядки" }));
    fireEvent.click(await screen.findByRole("button", { name: /SILPO 2/ }));
    expect(screen.getByText("Рядок виключено: його не буде імпортовано.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Включити" }));
    await waitFor(() => expect(server.rows[1]!.state).toBe("ok"));
    expect(calls.filter((c) => c.path.includes("/recipes"))).toHaveLength(0);
  });

  it("IMP-08@PoC FR 6: a row with an error says why, and the batch cannot be applied while it is there", async () => {
    const server = new Server([row(1), row(2, { state: "error", issue: "unreadable" })]);
    const { client } = api(server);
    renderAt(at(), client);
    fireEvent.click(await screen.findByRole("button", { name: /SILPO 2/ }));
    expect(screen.getByText("Рядок не можна імпортувати.")).toBeTruthy();
    expect(screen.getByText("Не вдалося прочитати дату або суму.")).toBeTruthy();
    expect(isDisabled(applyButton())).toBe(true);
    expect(screen.getByText(/Є рядки з помилкою/)).toBeTruthy();
  });
});

describe("IMP-08@PoC FR 7, AC4 — one-click readings with «чому так»", () => {
  it("IMP-08@PoC AC4: «1 234» in one click makes the row «гаразд» and «Чому так» names the evidence", async () => {
    const server = new Server([ambiguous(1), row(2)]);
    const { client, calls } = api(server);
    renderAt(at(), client);
    await screen.findByText("Суму «1.234» можна прочитати двома способами.");
    expect(plain(screen.getByText(/Це 1,234 або 1 234\./).textContent)).toContain("Це 1,234 або 1 234.");
    fireEvent.click(screen.getByText("Чому так"));
    expect(screen.getByText(/У 7 клітинок сума записана без дробової частини/)).toBeTruthy();
    fireEvent.click(named("Це 1 234"));
    await waitFor(() => expect(screen.getByText("Питань немає")).toBeTruthy());
    expect(decisionsOf(calls)).toEqual([
      { decisions: [{ kind: "reading", fileId: F1, row: 1, value: "1234", applyToFile: false }] },
    ]);
    // The row now reads «гаразд»: not a question any more, and marked as changed in the full list.
    fireEvent.click(screen.getByRole("radio", { name: "Усі рядки" }));
    const line = await waitFor(() => lineOf("SILPO 1"));
    expect(within(line).queryByText("Уточнення")).toBeNull();
    expect(within(line).getByText("Змінено")).toBeTruthy();
  });

  it("IMP-08@PoC FR 8: the order of day and month is a question of the file with two answers", async () => {
    const server = new Server([row(1)]);
    server.dateOrder = true;
    const { client, calls } = api(server);
    renderAt(at(), client);
    await screen.findByText("Порядок дня й місяця.");
    fireEvent.click(screen.getByRole("button", { name: "Місяць-день" }));
    await waitFor(() => expect(screen.queryByText("Порядок дня й місяця.")).toBeNull());
    expect(decisionsOf(calls)).toEqual([{ decisions: [{ kind: "date-order", fileId: F1, order: "mdy" }] }]);
  });
});

describe("IMP-08@PoC AC5, FR 6 — the group «знак не підтверджено»", () => {
  it("IMP-08@PoC AC5: «Перевернути знак» for the group flips every row of it in one answer; the recipe is untouched", async () => {
    const server = longServer();
    const { client, calls } = api(server);
    renderAt(at(), client);
    const group = await screen.findByRole("region", { name: "Знак не підтверджено" });
    expect(plain(group.textContent)).toContain("4 рядки");
    fireEvent.click(within(group).getByRole("button", { name: "Перевернути знак" }));
    await waitFor(() =>
      expect(plain(screen.getByRole("region", { name: "Знак не підтверджено" }).textContent)).toContain(
        "Знак групи перевернуто.",
      ),
    );
    expect(decisionsOf(calls)).toEqual([
      { decisions: [{ kind: "group", fileId: F1, group: "review", action: "flip-sign" }] },
    ]);
    expect(server.rows.filter((r) => r.changed)).toHaveLength(4);
    expect(calls.filter((c) => c.path.includes("/recipes"))).toHaveLength(0);
  });

  it("IMP-08@PoC FR 6: «Прийняти групу» accepts the whole group at once", async () => {
    const { client, calls } = api(longServer());
    renderAt(at(), client);
    fireEvent.click(await screen.findByRole("button", { name: "Прийняти групу" }));
    await waitFor(() => expect(decisionsOf(calls)).toHaveLength(1));
    expect(decisionsOf(calls)[0]).toEqual({
      decisions: [{ kind: "group", fileId: F1, group: "review", action: "accept" }],
    });
  });
});

describe("IMP-08@PoC FR 9 — the banners of the batch", () => {
  it("IMP-08@PoC FR 9: a control-sum mismatch names the difference and asks for the balance choice; the answer confirms it", async () => {
    const server = new Server([row(1)]);
    server.flags = [{ code: "checksum-mismatch", severity: "review", difference: "46.20" }];
    server.open.add("checksum-mismatch");
    const { client, calls } = api(server);
    renderAt(at(), client);
    const banner = await screen.findByRole("region", { name: "Підсумки не збігаються." });
    expect(plain(banner.textContent)).toContain("46,20 €");
    expect(plain(banner.textContent)).toContain("Перегляд");
    expect(isDisabled(applyButton())).toBe(true);
    expect(screen.getByText("Не підтверджені позначки")).toBeTruthy();
    fireEvent.click(within(banner).getByRole("button", { name: "Застосувати без оновлення залишку" }));
    await waitFor(() => expect(screen.getByText("Підтверджено.")).toBeTruthy());
    expect(decisionsOf(calls)).toEqual([{ decisions: [{ kind: "balance", fileId: F1, choice: "keep" }] }]);
    await waitFor(() => expect(isDisabled(applyButton())).toBe(false));
  });

  it("IMP-08@PoC FR 9: «Знак картки» counts the rows and is confirmed, or the sign is flipped for the file", async () => {
    const server = new Server([row(1)]);
    server.flags = [{ code: "card-sign", severity: "review", positive: 38, negative: 2 }];
    server.open.add("card-sign");
    const { client, calls } = api(server);
    renderAt(at(), client);
    const banner = await screen.findByRole("region", { name: "Знак картки." });
    expect(plain(banner.textContent)).toContain("додатних 38, від'ємних 2");
    fireEvent.click(within(banner).getByRole("button", { name: "Підтвердити" }));
    await waitFor(() => expect(screen.getByText("Підтверджено.")).toBeTruthy());
    expect(decisionsOf(calls)).toEqual([{ decisions: [{ kind: "flag", fileId: F1, code: "card-sign" }] }]);
  });

  it("IMP-08@PoC FR 9: a blocking flag is marked by the word «Блокування» and its marker, not only by colour", async () => {
    const server = new Server([row(1)]);
    server.flags = [{ code: "no-transactions", severity: "block" }];
    server.open.add("no-transactions");
    const { client } = api(server);
    renderAt(at(), client);
    const banner = await screen.findByRole("region", { name: "Немає транзакцій." });
    expect(within(banner).getByText("Блокування").closest("[data-tone]")?.getAttribute("data-tone")).toBe(
      "negative",
    );
    expect(within(banner).getByText("Блокування").previousElementSibling?.textContent).toBe("✕");
  });

  it("IMP-05@PoC FR 3: a gap in the history shows the range, both balances and the difference as the API gave them", async () => {
    const server = new Server([row(1)]);
    server.history = {
      status: "gap",
      range: { from: "2026-04-01", to: "2026-04-14" },
      previousClosing: "2000.00",
      newOpening: "2300.00",
      difference: "300.00",
      currency: "EUR",
    };
    const { client } = api(server);
    renderAt(at(), client);
    const banner = await screen.findByRole("region", { name: "Розрив в історії." });
    const text = plain(banner.textContent);
    expect(text).toContain("Період без даних: 1 квіт. 2026 р. — 14 квіт. 2026 р.");
    expect(text).toContain("2 000,00 €");
    expect(text).toContain("2 300,00 €");
    expect(text).toContain("Різниця — 300,00 €.");
  });

  it("IMP-05@PoC FR 2: when every check passes the step says «Підсумки виписки збігаються»", async () => {
    const { client } = api(new Server([row(1)]));
    renderAt(at(), client);
    expect(await screen.findByText("Підсумки виписки збігаються")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Підсумки не збігаються." })).toBeNull();
  });

  it("IMP-08@PoC EC1: a file whose format changed against its template is said so on the step", async () => {
    const { client } = api(new Server([row(1)]), { recipe: "changed" });
    renderAt(at(), client);
    expect(await screen.findByText(/Формат файлу змінився порівняно з шаблоном/)).toBeTruthy();
  });
});

describe("IMP-08@PoC FR 6, IMP-04@PoC FR 3 — duplicates before the apply", () => {
  it("IMP-04@PoC FR 3: the duplicates the apply would skip are counted by kind and marked on their rows", async () => {
    const server = new Server([row(1), row(2), row(3)]);
    server.duplicates = [
      { row: 2, kind: "duplicate" },
      { row: 3, kind: "already-imported" },
    ];
    server.afterEarlierFile = true;
    const { client } = api(server);
    renderAt(at(), client);
    fireEvent.click(await screen.findByRole("radio", { name: "Усі рядки" }));
    const dups = await screen.findByRole("region", { name: "Дублі" });
    expect(plain(dups.textContent)).toContain("2 рядки не запишемо як нові: Дубль: 1 · Вже імпортовано: 1.");
    expect(plain(dups.textContent)).toContain("Інший файл цієї партії має той самий рахунок");
    await screen.findByText("SILPO 2");
    expect(within(lineOf("SILPO 2")).getByText("Дубль")).toBeTruthy();
    expect(within(lineOf("SILPO 3")).getByText("Вже імпортовано")).toBeTruthy();
    expect(within(lineOf("SILPO 1")).queryByText("Дубль")).toBeNull();
  });

  it("IMP-04@PoC FR 3: no duplicates is said in one line; a failed preview is «✕ Помилка» with its code and a retry", async () => {
    const quiet = api(new Server([row(1)]));
    const first = renderAt(at(), quiet.client);
    expect(await screen.findByText("Дублів не знайдено.")).toBeTruthy();
    first.unmount();

    const server = new Server([row(1)]);
    let failing = true;
    const { client } = api(server, {
      over: {
        [`GET /v1/import/batches/${BATCH}/files/${F1}/duplicates`]: () =>
          failing ? problem(500, "INTERNAL") : server.dupes(),
      },
    });
    renderAt(at(), client);
    expect(await screen.findByText("Не вдалося перевірити дублі.")).toBeTruthy();
    expect(screen.getByText(`Код: ${SUPPORT_ID}`)).toBeTruthy();
    failing = false;
    fireEvent.click(screen.getAllByRole("button", { name: "Спробувати ще раз" })[0]!);
    expect(await screen.findByText("Дублів не знайдено.")).toBeTruthy();
  });
});

describe("IMP-08@PoC FR 16 — states of the step", () => {
  it("IMP-08@PoC FR 16: while the batch loads the step shows a skeleton, not the panel", async () => {
    const { client } = api(new Server([row(1)]), {
      over: { [`GET /v1/import/batches/${BATCH}`]: () => new Promise<Reply>(() => undefined) },
    });
    renderAt(at(), client);
    expect(await screen.findByRole("heading", { name: "Перевірка розпізнавання" })).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Як ми прочитали" })).toBeNull();
  });

  it("IMP-08@PoC FR 16: a failed read of the batch is «✕ Помилка» with the API's code; «Спробувати ще раз» reads again", async () => {
    let failing = true;
    const server = new Server([row(1)]);
    const { client } = api(server, {
      over: {
        [`GET /v1/import/batches/${BATCH}/readiness`]: () =>
          failing ? problem(500, "INTERNAL") : server.readiness(),
      },
    });
    renderAt(at(), client);
    expect(await screen.findByText("Не вдалося завантажити перевірку.")).toBeTruthy();
    expect(screen.getByText(`Код: ${SUPPORT_ID}`)).toBeTruthy();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByRole("heading", { name: "Як ми прочитали" })).toBeTruthy();
  });

  it("IMP-08@PoC FR 16: a lost connection on the rows is an error of the list that retries, the counters stay", async () => {
    const server = new Server([ambiguous(1)]);
    let failing = true;
    const { client } = api(server, {
      over: {
        [`GET /v1/import/batches/${BATCH}/files/${F1}/review/rows`]: (_c, u) =>
          failing ? "network" : server.reviewRows(u),
      },
    });
    renderAt(at(), client);
    expect(await screen.findByText("Не вдалося завантажити рядки.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Підсумок розпізнавання" })).toBeTruthy();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByText("Суму «1.234» можна прочитати двома способами.")).toBeTruthy();
  });

  it("IMP-08@PoC FR 16: a failed summary of the file is its own error with the code; the rest of the step stays", async () => {
    const { client } = api(new Server([row(1)]), {
      over: {
        [`GET /v1/import/batches/${BATCH}/files/${F1}/review`]: () => problem(409, "BATCH_STATE_CONFLICT"),
      },
    });
    renderAt(at(), client);
    expect(await screen.findByText("Не вдалося завантажити підсумок файлу.")).toBeTruthy();
    expect(screen.getByText(`Код: ${SUPPORT_ID}`)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Усі рядки" })).toBeTruthy();
    expect(isDisabled(applyButton())).toBe(true);
  });

  it("IMP-08@PoC FR 16: a batch with no problem rows says «Питань немає» and «Застосувати» is available at once (EC2)", async () => {
    const { client } = api(new Server([row(1), row(2)]));
    renderAt(at(), client);
    expect(await screen.findByText("Питань немає")).toBeTruthy();
    expect(screen.getByText("Усі рядки розпізнано. Можна застосовувати.")).toBeTruthy();
    await waitFor(() => expect(isDisabled(applyButton())).toBe(false));
    expect(applyButton().getAttribute("href")).toBe(`#${importPath(BATCH, "result")}`);
    // IMP-08@PoC c): the click is the one-shot intent the result step reads; nothing arms it before the click.
    expect(takeApplyIntent(BATCH)).toBe(false);
    fireEvent.click(applyButton());
    expect(takeApplyIntent(BATCH)).toBe(true);
    expect(takeApplyIntent(BATCH)).toBe(false);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])(
    "IMP-08@PoC c): a modified or middle click of «Застосувати» (%o, a new tab or window) arms no intent in this tab",
    async (init) => {
      // A hash change left by the test before (its plain click followed the link) settles first.
      await new Promise((r) => setTimeout(r, 0));
      const { client } = api(new Server([row(1), row(2)]));
      renderAt(at(), client);
      expect(await screen.findByText("Питань немає")).toBeTruthy();
      await waitFor(() => expect(isDisabled(applyButton())).toBe(false));
      takeApplyIntent(BATCH);
      // The browser would open another tab; here the link is not followed at all.
      window.addEventListener("click", (e) => e.preventDefault(), { capture: true, once: true });
      fireEvent.click(applyButton(), init);
      expect(takeApplyIntent(BATCH)).toBe(false);
    },
  );

  it("IMP-08@PoC FR 16: an unknown or foreign batch is «Імпорт не знайдено» with a way to start again", async () => {
    const { client } = api(new Server([row(1)]), {
      over: { [`GET /v1/import/batches/${BATCH}`]: () => problem(404, "NOT_FOUND") },
    });
    renderAt(at(), client);
    expect(await screen.findByText("Імпорт не знайдено")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Почати новий імпорт" }).getAttribute("href")).toBe("#/import");
  });

  it("IMP-08@PoC FR 16: an applied batch has no review any more and leads to its result", async () => {
    const { client } = api(new Server([row(1)]), { state: "applied" });
    renderAt(at(), client);
    expect(await screen.findByText("Імпорт уже завершено")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Відкрити результат" }).getAttribute("href")).toBe(
      `#${importPath(BATCH, "result")}`,
    );
  });

  it("IMP-08@PoC FR 16: a failed answer says so with the API's code and keeps the question", async () => {
    const server = new Server([ambiguous(1)]);
    const { client } = api(server, {
      over: { [`POST /v1/import/batches/${BATCH}/decisions`]: () => problem(409, "BATCH_STATE_CONFLICT") },
    });
    renderAt(at(), client);
    fireEvent.click(await screen.findByRole("button", { name: (n) => plain(n) === "Це 1 234" }));
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toContain("Партію вже не можна змінити");
    expect(plain(alert.textContent)).toContain(`Код: ${SUPPORT_ID}`);
    expect(named("Це 1 234")).toBeTruthy();
  });
});

describe("IMP-08@PoC — a long batch is read page by page", () => {
  it("IMP-08@PoC FR 5: 200 rows come 50 at a time; «Показати ще» reads the next page with the cursor of the last one", async () => {
    const { client, calls } = api(longServer());
    renderAt(at(), client);
    fireEvent.click(await screen.findByRole("radio", { name: "Усі рядки" }));
    await screen.findByText("Показано 50 з 200");
    const list = screen.getByRole("list", { name: "Рядки виписки" });
    expect(list.querySelectorAll(":scope > li")).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "Показати ще" }));
    await screen.findByText("Показано 100 з 200");
    const reads = calls.filter((c) => c.path.endsWith(`/files/${F1}/review/rows`));
    expect(reads.length).toBeGreaterThanOrEqual(2);
    // The values of row 100 came with it (the file's rows are read in order as far as the list goes).
    expect(plain(lineOf("SILPO 100").textContent)).toContain("−38,10 €");
  });

  it("IMP-08@PoC FR 5: the last page has no «Показати ще»", async () => {
    const { client } = api(new Server(Array.from({ length: 60 }, (_, i) => row(i + 1))));
    renderAt(at(), client);
    fireEvent.click(await screen.findByRole("radio", { name: "Усі рядки" }));
    fireEvent.click(await screen.findByRole("button", { name: "Показати ще" }));
    await screen.findByText("Показано 60 з 60");
    expect(screen.queryByRole("button", { name: "Показати ще" })).toBeNull();
  });
});

describe("IMP-08@PoC — several files in one batch", () => {
  it("IMP-08@PoC FR 5: the file is chosen above the panel; its own review, rows and duplicates are read", async () => {
    const one = new Server([row(1)]);
    const two = new Server([row(1, { text: "ROZETKA" }), ambiguous(2, { text: "NOVA POSHTA" })]);
    const { client, calls } = api({ [F1]: one, [F2]: two });
    renderAt(at(), client);
    const select = await screen.findByRole("combobox", { name: "Файл" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => plain(o.textContent)),
    ).toContain("privat-oct-2026.xls · 1 рядок");
    expect(
      plain((await screen.findByRole("list", { name: "Підсумок розпізнавання" })).textContent),
    ).toContain("1 розібрано");
    fireEvent.change(select, { target: { value: F2 } });
    await screen.findByText("NOVA POSHTA");
    await waitFor(() =>
      expect(plain(screen.getByRole("list", { name: "Підсумок розпізнавання" }).textContent)).toContain(
        "2 розібрано",
      ),
    );
    expect(calls.some((c) => c.path.endsWith(`/files/${F2}/duplicates`))).toBe(true);
  });

  it("IMP-08@PoC FR 6: a row with an error in another file of the batch also blocks «Застосувати»", async () => {
    const clean = new Server([row(1)]);
    const broken = new Server([row(1), row(2, { state: "error", issue: "unreadable" })]);
    const { client } = api({ [F1]: clean, [F2]: broken });
    renderAt(at(), client);
    // The file on screen is the clean one; the error is in the second file.
    expect(await screen.findByText("Питань немає")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Є рядки з помилкою/)).toBeTruthy());
    expect(isDisabled(applyButton())).toBe(true);
  });

  it("IMP-08@PoC FR 16: a batch whose files all failed has nothing to review and leads back to the files", async () => {
    const { client } = api(new Server([row(1)]), {
      over: {
        [`GET /v1/import/batches/${BATCH}/parse`]: () => ({
          status: 200,
          body: {
            batch: batchOf(),
            progress: { pending: 0, parsed: 0, failed: 1 },
            files: [
              {
                fileId: F1,
                position: 1,
                state: "failed",
                refusal: { code: "PARSE_TIMEOUT", message: { uk: "x", en: "x" } },
                recipe: null,
                accountId: null,
                engineVersion: "1",
                rowCount: null,
                checks: null,
                history: null,
                previousFileId: null,
              },
            ],
          },
        }),
      },
    });
    renderAt(at(), client);
    expect(await screen.findByText("Немає файлів для перевірки")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Назад" }).getAttribute("href")).toBe(`#${importPath(BATCH)}`);
  });
});

describe("IMP-08@PoC FR 14, FR 15 — keyboard, names, long texts", () => {
  it("IMP-08@PoC FR 14: every row is a button that says whether it is open; every control has a name and no positive tabindex", async () => {
    const { client } = api(longServer());
    renderAt(at(), client);
    const first = await screen.findByRole("button", { name: /SILPO 3\b/ });
    expect(first.getAttribute("aria-expanded")).toBe("true");
    const second = screen.getByRole("button", { name: /SILPO 9\b/ });
    expect(second.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(second);
    expect(second.getAttribute("aria-expanded")).toBe("true");
    expect(first.getAttribute("aria-expanded")).toBe("false");
    const main = document.querySelector("main")!;
    for (const el of main.querySelectorAll<HTMLElement>("button, a[href], select, input, summary")) {
      expect(el.getAttribute("tabindex") ?? "0").not.toMatch(/^[1-9]/);
      const labels = el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el.labels : null;
      const name =
        el.getAttribute("aria-label") ??
        (labels && labels.length > 0 ? labels[0]!.textContent : el.textContent) ??
        "";
      expect(plain(name).trim().length).toBeGreaterThan(0);
    }
  });

  it("IMP-08@PoC FR 14: a button that waits for a saved answer keeps its place and says why beside it", async () => {
    const server = new Server([ambiguous(1)]);
    const { client } = api(server, {
      over: { [`POST /v1/import/batches/${BATCH}/decisions`]: () => new Promise<Reply>(() => undefined) },
    });
    renderAt(at(), client);
    fireEvent.click(await screen.findByRole("button", { name: (n) => plain(n) === "Це 1 234" }));
    await waitFor(() => expect(screen.getAllByText("Зберігаємо відповідь…").length).toBeGreaterThan(0));
    expect(isDisabled(named("Це 1 234"))).toBe(true);
  });

  it("IMP-08@PoC FR 14: the stylesheet lets long names, amounts and one long word wrap; the panel never scrolls sideways", () => {
    expect(css).toMatch(/\.imp-r-text[^{]*\{[^}]*overflow-wrap: anywhere/s);
    expect(css).toMatch(/\.imp-r-body[^{]*\{[^}]*overflow-wrap: anywhere/s);
    expect(css).toMatch(/\.imp-panel[^{]*\{[^}]*min-width: 0/s);
    expect(css).not.toMatch(/overflow-x:\s*(scroll|auto)/);
  });

  it("IMP-08@PoC FR 15: the step reads in English too: the title, the tabs, the question and its answers", async () => {
    const { client } = api(new Server([ambiguous(1)]));
    render(
      <I18nProvider initialLocale="en">
        <AuthApiProvider value={client}>
          <ReviewStep batchId={BATCH} />
        </AuthApiProvider>
      </I18nProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Review of the reading" })).toBeTruthy();
    expect(await screen.findByRole("radio", { name: "Questions · 1" })).toBeTruthy();
    expect(screen.getByText("The amount «1.234» can be read in two ways.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "It is 1,234" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back" })).toBeTruthy();
  });
});
