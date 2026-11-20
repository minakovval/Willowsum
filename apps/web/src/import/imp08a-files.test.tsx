import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { createAuthClient } from "../auth/api.ts";
import { plain, problem, renderAt, resetAuthState, SUPPORT_ID, type Reply } from "../auth/testing.tsx";
import { importPath, resolveRoute } from "../routing/routes.ts";
import { resetNavigationSession } from "../routing/session.ts";
import { POLLING } from "./useImportStep.ts";

/**
 * IMP-08@PoC a) (wave 2, row 136) — the step «Рахунок і файли» of the import wizard, S-170 (canvas PocMoneyImport1 and its
 * «Тексти» board PocMoneyImport1Texts), on `POST /v1/import/batches`, `…/files`, `…/parse`, `GET …/parse`, `…/readiness` and
 * `GET /v1/accounts` (IMP-01@PoC FR 1–3, FR 6, FR 13–15). Synthetic accounts and files only; the file contents are
 * never read by the screen.
 */
const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, "import.css"), "utf8");

const BATCH = "00000000-0000-4000-8000-0000000000b1";
const CURRENT = "00000000-0000-4000-8000-000000000001";
const SAVINGS = "00000000-0000-4000-8000-000000000002";
const CARD = "00000000-0000-4000-8000-000000000003";
const LOAN = "00000000-0000-4000-8000-000000000004";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const F2 = "00000000-0000-4000-8000-0000000000f2";
const F3 = "00000000-0000-4000-8000-0000000000f3";

const account = (id: string, kind: string, name: string, last4: string | null) => ({
  id,
  kind,
  group: kind === "credit-card" || kind === "loan" ? "credit" : "cash",
  name,
  institution: null,
  number: last4 ? { last4, masked: `••${last4}` } : null,
  status: "active",
  closedOn: null,
  source: "manual",
  updatedOn: "2026-11-02",
  favourite: false,
  inProfileCurrency: null,
  currencies: [],
  creditCard: null,
  loan: null,
});
const ACCOUNTS = [
  account(CURRENT, "current", "Поточний", "4417"),
  account(SAVINGS, "savings", "Ощадний", "1180"),
  account(CARD, "credit-card", "Кредитна", "9021"),
  account(LOAN, "loan", "Автокредит", null),
];

const batch = (state = "uploaded", accepted = 0, rejected = 0) => ({
  id: BATCH,
  name: null,
  state,
  version: 1,
  createdAt: "2026-11-02T10:00:00Z",
  lastActionAt: "2026-11-02T10:00:00Z",
  applying: false,
  files: { accepted, rejected },
});
const file = (id: string, fileName: string, over: Record<string, unknown> = {}) => ({
  id,
  position: 1,
  fileName,
  status: "accepted",
  format: "csv",
  sizeBytes: 214_000,
  rejectionCode: null,
  createdAt: "2026-11-02T10:00:00Z",
  rejection: null,
  ...over,
});
const parsed = (fileId: string, over: Record<string, unknown> = {}) => ({
  fileId,
  position: 1,
  state: "parsed",
  refusal: null,
  recipe: null,
  accountId: CURRENT,
  engineVersion: "1",
  rowCount: 186,
  checks: null,
  history: null,
  previousFileId: null,
  ...over,
});
const view = (files: unknown[], pending = 0) => ({
  batch: batch("parsed", files.length),
  progress: { pending, parsed: files.length - pending, failed: 0 },
  files,
});
const ready = { ready: true, refusals: [], codes: [], files: [] };

type Handler = Reply | ((call: Sent) => Reply | Promise<Reply>);
interface Sent {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly parts: number;
}

/** A fake API; `{b}` stands for the batch id in a path. Every request is recorded (a multipart body as its part count). */
function api(over: Record<string, Handler> = {}) {
  const sent: Sent[] = [];
  const handlers: Record<string, Handler> = {
    "GET /v1/accounts": { status: 200, body: { items: ACCOUNTS, nextCursor: null } },
    "POST /v1/import/batches": { status: 201, body: batch() },
    "POST /v1/import/batches/{b}/files": { status: 201, body: { batch: batch(), files: [], refused: [] } },
    "GET /v1/import/batches/{b}": { status: 200, body: { ...batch(), fileList: [] } },
    "POST /v1/import/batches/{b}/parse": { status: 200, body: batch("processing") },
    "GET /v1/import/batches/{b}/parse": { status: 200, body: view([]) },
    "GET /v1/import/batches/{b}/readiness": { status: 200, body: ready },
    "POST /v1/import/batches/{b}/decisions": {
      status: 200,
      body: { version: 2, decisions: [], nextCursor: null },
    },
    "POST /v1/import/batches/{b}/cancel": { status: 200, body: batch("cancelled") },
    ...over,
  };
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname.replace(BATCH, "{b}");
    const multipart = (request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
    const text = request.method === "GET" ? "" : await request.text();
    const call: Sent = {
      method: request.method,
      path,
      body: multipart || !text ? undefined : (JSON.parse(text) as unknown),
      parts: multipart ? (text.match(/name="files"/g) ?? []).length : 0,
    };
    sent.push(call);
    const handler = handlers[`${call.method} ${path}`];
    const reply = typeof handler === "function" ? await handler(call) : handler;
    if (reply === undefined) return new Response(null, { status: 599 });
    if (reply === "network") throw new TypeError("Failed to fetch");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return {
    client: createAuthClient(fetchImpl as typeof fetch),
    sent,
    of: (method: string, path: string) => sent.filter((s) => s.method === method && s.path === path),
  };
}

const csv = (name: string, size = 214) => {
  const f = new File(["x"], name, { type: "text/csv" });
  Object.defineProperty(f, "size", { value: size * 1000 });
  return f;
};
const sized = (name: string, bytes: number) => {
  const f = new File(["x"], name, { type: "text/csv" });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
};

/** Puts files into the picker the way the browser does. */
function pick(files: File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files } });
}

const stateOf = (name: string) => {
  const row = screen.getByText(name).closest("li")!;
  return within(row);
};
const nextButton = () => screen.getByText("Далі").closest("a, button") as HTMLElement;
const disabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true";

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  POLLING.ms = 5;
});

describe("IMP-08@PoC FR 1 — the address of the step", () => {
  it("IMP-08@PoC FR 1: every step has its own address; a path that is not a batch id stays unknown", () => {
    expect(resolveRoute("/import")).toEqual({ kind: "importWizard", batchId: null, step: "files" });
    expect(resolveRoute(importPath(BATCH))).toEqual({ kind: "importWizard", batchId: BATCH, step: "files" });
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
    expect(resolveRoute("/import/x").kind).toBe("notFound");
  });

  it("IMP-08@PoC FR 1: «Імпортувати виписку» opens `/import` in focus mode: no navigation, the step list names «Рахунок і файли»", async () => {
    const { client } = api();
    renderAt("#/import", client);
    expect(await screen.findByText("Перетягніть файли виписок сюди або оберіть їх")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: /Основна/ })).toBeNull();
    const steps = screen.getByRole("list", { name: "Кроки імпорту" });
    expect(within(steps).getByText("Рахунок і файли")).toBeTruthy();
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain("Рахунок і файли");
    expect(plain(screen.getByText(/Рахунок визначається з кожного файлу автоматично/).textContent)).toContain(
      "Якщо ми не впевнені, попросимо обрати.",
    );
  });

  it("IMP-08@PoC AC8: the same address after a reload opens the same batch with its files and their results", async () => {
    const { client, of } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("parsed", 1), fileList: [file(F1, "mono-oct-2026.csv")] },
      },
      "GET /v1/import/batches/{b}/parse": { status: 200, body: view([parsed(F1)]) },
    });
    renderAt(`#/import/${BATCH}`, client);
    expect(await screen.findByText("mono-oct-2026.csv")).toBeTruthy();
    expect(within(screen.getByText("mono-oct-2026.csv").closest("li")!).getByText("Готовий")).toBeTruthy();
    // Nothing was created again; a batch that nobody started parsing is not parsed twice.
    expect(of("POST", "/v1/import/batches")).toHaveLength(0);
    expect(of("POST", "/v1/import/batches/{b}/parse")).toHaveLength(0);
  });

  it("IMP-08@PoC FR 1: a reload of a batch whose files were uploaded but not parsed starts the parse", async () => {
    const { client, of } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("uploaded", 1), fileList: [file(F1, "mono-oct-2026.csv")] },
      },
      "GET /v1/import/batches/{b}/parse": { status: 200, body: view([parsed(F1)]) },
    });
    renderAt(`#/import/${BATCH}`, client);
    await screen.findByText("Готовий");
    expect(of("POST", "/v1/import/batches/{b}/parse")[0]?.body).toEqual({ files: [{ fileId: F1 }] });
  });

  it("IMP-08@PoC FR 16: an unknown or foreign batch is «Імпорт не знайдено» with a way to start again", async () => {
    const { client } = api({ "GET /v1/import/batches/{b}": problem(404, "NOT_FOUND") });
    renderAt(`#/import/${BATCH}`, client);
    expect(await screen.findByText("Імпорт не знайдено")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Почати новий імпорт" }).getAttribute("href")).toBe("#/import");
  });
});

describe("IMP-08@PoC AC1 — uploading and the result of each file", () => {
  it("IMP-08@PoC AC1: three files dropped at once make one batch, go up in one request, show «Розбираємо…» and then each result", async () => {
    let polls = 0;
    const { client, of } = api({
      "POST /v1/import/batches/{b}/files": {
        status: 201,
        body: {
          batch: batch("uploaded", 3),
          files: [
            file(F1, "mono-oct-2026.csv"),
            file(F2, "privat-oct-2026.xls"),
            file(F3, "wise-statement.xlsx"),
          ],
          refused: [],
        },
      },
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: {
          ...batch("uploaded", 3),
          fileList: [
            file(F1, "mono-oct-2026.csv"),
            file(F2, "privat-oct-2026.xls"),
            file(F3, "wise-statement.xlsx"),
          ],
        },
      },
      "GET /v1/import/batches/{b}/parse": () => {
        polls += 1;
        return {
          status: 200,
          body:
            polls === 1
              ? view([parsed(F1, { state: "pending" }), parsed(F2), parsed(F3, { state: "pending" })], 2)
              : view([
                  parsed(F1),
                  parsed(F2, { accountId: SAVINGS, rowCount: 62 }),
                  parsed(F3, { accountId: CARD }),
                ]),
        };
      },
    });
    renderAt("#/import", client);
    await screen.findByText("Перетягніть файли виписок сюди або оберіть їх");
    pick([csv("mono-oct-2026.csv"), csv("privat-oct-2026.xls"), csv("wise-statement.xlsx")]);

    // Upload in progress: each file has its own row with its state.
    expect((await screen.findAllByText("Завантажуємо…")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByText("Розбираємо…").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText("Готовий")).toHaveLength(3));

    expect(of("POST", "/v1/import/batches")).toHaveLength(1);
    expect(of("POST", "/v1/import/batches/{b}/files")).toHaveLength(1);
    expect(of("POST", "/v1/import/batches/{b}/files")[0]!.parts).toBe(3);
    expect(of("POST", "/v1/import/batches/{b}/parse")[0]?.body).toEqual({
      files: [{ fileId: F1 }, { fileId: F2 }, { fileId: F3 }],
    });
    // The address is the batch's: a reload returns to it (FR 1).
    expect(window.location.hash).toBe(`#/import/${BATCH}`);
    expect(stateOf("privat-oct-2026.xls").getByText(/62 рядки/)).toBeTruthy();
  });

  it("IMP-08@PoC FR 3: each file shows its size and its row count as the API gave them", async () => {
    const { client } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: {
          ...batch("parsed", 2),
          fileList: [
            file(F1, "a.csv", { sizeBytes: 214 * 1024 }),
            file(F2, "b.xlsx", { sizeBytes: 1_258_291 }),
          ],
        },
      },
      "GET /v1/import/batches/{b}/parse": {
        status: 200,
        body: view([parsed(F1, { rowCount: 186 }), parsed(F2, { rowCount: 1 })]),
      },
    });
    renderAt(`#/import/${BATCH}`, client);
    expect(await screen.findByText("214 КБ · 186 рядків")).toBeTruthy();
    expect(plain(screen.getByText(/МБ · 1 рядок/).textContent)).toBe("1,2 МБ · 1 рядок");
  });
});

describe("IMP-08@PoC FR 2 — the account of each file", () => {
  it("IMP-08@PoC FR 2, partly the acceptance criterion on the account basis: a file's account is the one the API found; there is no common account choice for the batch", async () => {
    const { client } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: {
          ...batch("parsed", 2),
          fileList: [file(F1, "current.csv"), file(F2, "card.xlsx", { format: "xlsx" })],
        },
      },
      "GET /v1/import/batches/{b}/parse": {
        status: 200,
        body: view([parsed(F1, { accountId: CURRENT }), parsed(F2, { accountId: CARD })]),
      },
    });
    renderAt(`#/import/${BATCH}`, client);
    await screen.findByText("current.csv");
    expect(stateOf("current.csv").getByText("Поточний ··4417")).toBeTruthy();
    expect(stateOf("card.xlsx").getByText(/Кредитна ··9021 · кредитна картка/)).toBeTruthy();
    expect(stateOf("card.xlsx").getByText("визначено автоматично")).toBeTruthy();
    // No account list for the batch: the only choices are the per-file «Змінити рахунок» buttons.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Змінити рахунок" })).toHaveLength(2);
  });

  it("IMP-08@PoC FR 2, partly the acceptance criterion on two candidates: a file whose account is not found asks «Оберіть рахунок» with the best guess and the full list", async () => {
    let chosen = false;
    const { client, of } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("parsed", 1), fileList: [file(F1, "export (3).xlsx", { format: "xlsx" })] },
      },
      "GET /v1/import/batches/{b}/parse": () => ({
        status: 200,
        body: view([parsed(F1, { accountId: chosen ? SAVINGS : null })]),
      }),
      "GET /v1/import/batches/{b}/readiness": () => ({
        status: 200,
        body: chosen
          ? ready
          : {
              ready: false,
              codes: ["confirm-account"],
              files: [],
              refusals: [
                {
                  code: "confirm-account",
                  message: { uk: "Підтвердіть рахунок", en: "Confirm the account" },
                  files: [{ fileId: F1, missing: true, reasons: [], suggestedAccountId: SAVINGS }],
                },
              ],
            },
      }),
      "POST /v1/import/batches/{b}/parse": () => {
        chosen = true;
        return { status: 200, body: batch("processing") };
      },
    });
    renderAt(`#/import/${BATCH}`, client);
    const select = (await screen.findByRole("combobox", {
      name: "Рахунок для файлу export (3).xlsx",
    })) as HTMLSelectElement;
    expect(within(select).getByRole("option", { name: "Оберіть рахунок" })).toBeTruthy();
    expect(plain(screen.getByText(/Не впевнені: схоже на/).textContent)).toBe(
      "Не впевнені: схоже на «Ощадний ··1180»",
    );
    // The full list, with the marks of a credit card and a loan (IMP-01 AC13).
    const labels = within(select)
      .getAllByRole("option")
      .map((o) => plain(o.textContent));
    expect(labels).toEqual([
      "Оберіть рахунок",
      "Поточний ··4417",
      "Ощадний ··1180",
      "Кредитна ··9021 · кредитна картка",
      "Автокредит · кредит",
    ]);
    expect(
      within(stateOf("export (3).xlsx").getByText("Потрібна дія").closest("li")!).getByText("Потрібна дія"),
    ).toBeTruthy();
    expect(disabled(nextButton())).toBe(true);

    fireEvent.change(select, { target: { value: SAVINGS } });
    await waitFor(() => expect(stateOf("export (3).xlsx").getByText("Готовий")).toBeTruthy());
    expect(of("POST", "/v1/import/batches/{b}/parse").at(-1)?.body).toEqual({
      files: [{ fileId: F1, accountId: SAVINGS }],
    });
  });

  it("IMP-08@PoC FR 2: a file that shows another account's IBAN or card gets a warning and the choice", async () => {
    const { client, of } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("parsed", 1), fileList: [file(F1, "mono.csv")] },
      },
      "GET /v1/import/batches/{b}/parse": { status: 200, body: view([parsed(F1, { accountId: CURRENT })]) },
      "GET /v1/import/batches/{b}/readiness": {
        status: 200,
        body: {
          ready: false,
          codes: ["confirm-account"],
          files: [],
          refusals: [
            {
              code: "confirm-account",
              message: { uk: "Підтвердіть рахунок", en: "Confirm the account" },
              files: [
                {
                  fileId: F1,
                  missing: false,
                  reasons: [{ kind: "iban", file: "••4421", account: "••4417" }],
                  suggestedAccountId: null,
                },
              ],
            },
          ],
        },
      },
    });
    renderAt(`#/import/${BATCH}`, client);
    expect(await screen.findByText("У файлі схоже інший рахунок (IBAN). Перевірте вибір.")).toBeTruthy();
    const select = screen.getByRole("combobox", { name: "Рахунок для файлу mono.csv" }) as HTMLSelectElement;
    expect(select.value).toBe(CURRENT);
    expect(disabled(nextButton())).toBe(true);
    // The same account again is a confirmation (a decision), not a new parse.
    fireEvent.change(select, { target: { value: SAVINGS } });
    await waitFor(() => expect(of("POST", "/v1/import/batches/{b}/parse")).toHaveLength(1));
    const again = await screen.findByRole("combobox", { name: "Рахунок для файлу mono.csv" });
    fireEvent.change(again, { target: { value: CURRENT } });
    await waitFor(() => expect(of("POST", "/v1/import/batches/{b}/decisions")).toHaveLength(1));
    expect(of("POST", "/v1/import/batches/{b}/decisions")[0]?.body).toEqual({
      decisions: [{ kind: "account", fileId: F1 }],
    });
  });

  it("IMP-08@PoC FR 2: «Змінити рахунок» on a detected account opens the choice for that file only", async () => {
    const { client, of } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("parsed", 2), fileList: [file(F1, "a.csv"), file(F2, "b.csv")] },
      },
      "GET /v1/import/batches/{b}/parse": {
        status: 200,
        body: view([parsed(F1), parsed(F2, { accountId: SAVINGS })]),
      },
    });
    renderAt(`#/import/${BATCH}`, client);
    await screen.findByText("a.csv");
    fireEvent.click(
      within(screen.getByText("a.csv").closest("li")!).getByRole("button", { name: "Змінити рахунок" }),
    );
    const select = await screen.findByRole("combobox", { name: "Рахунок для файлу a.csv" });
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    fireEvent.change(select, { target: { value: CARD } });
    await waitFor(() => expect(of("POST", "/v1/import/batches/{b}/parse")).toHaveLength(1));
    expect(of("POST", "/v1/import/batches/{b}/parse")[0]?.body).toEqual({
      files: [{ fileId: F1, accountId: CARD }],
    });
  });

  it("IMP-08@PoC FR 2: a failed choice says so on the field and keeps the file waiting for an account", async () => {
    const { client } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("parsed", 1), fileList: [file(F1, "a.csv")] },
      },
      "GET /v1/import/batches/{b}/parse": { status: 200, body: view([parsed(F1, { accountId: null })]) },
      "POST /v1/import/batches/{b}/parse": problem(422, "IMPORT_PARSE_INVALID"),
    });
    renderAt(`#/import/${BATCH}`, client);
    const select = await screen.findByRole("combobox", { name: "Рахунок для файлу a.csv" });
    fireEvent.change(select, { target: { value: CURRENT } });
    expect(await screen.findByText(/Не вдалося зберегти вибір рахунку/)).toBeTruthy();
  });
});

describe("IMP-08@PoC FR 3 — the template of each file", () => {
  it("IMP-08@PoC FR 3: «Застосовано шаблон» for a match; «Формат змінився — перегляньте» with the banner for a changed format (EC1)", async () => {
    const { client } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("parsed", 2), fileList: [file(F1, "same.csv"), file(F2, "changed.csv")] },
      },
      "GET /v1/import/batches/{b}/parse": {
        status: 200,
        body: view([
          parsed(F1, { recipe: { id: "00000000-0000-4000-8000-0000000000a1", format: "match" } }),
          parsed(F2, { recipe: { id: "00000000-0000-4000-8000-0000000000a1", format: "changed" } }),
        ]),
      },
    });
    renderAt(`#/import/${BATCH}`, client);
    await screen.findByText("same.csv");
    expect(stateOf("same.csv").getByText("Застосовано шаблон")).toBeTruthy();
    expect(stateOf("changed.csv").getByText("Формат змінився — перегляньте")).toBeTruthy();
    expect(screen.getByText(/Шаблон знайдено, але формат змінився/)).toBeTruthy();
  });
});

describe("IMP-08@PoC FR 16 — states of the step", () => {
  it("IMP-08@PoC FR 16: while the accounts load the step shows a skeleton, not an empty dropzone", async () => {
    let release: (r: Reply) => void = () => undefined;
    const pending = new Promise<Reply>((r) => (release = r));
    const { client } = api({ "GET /v1/accounts": () => pending });
    renderAt("#/import", client);
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText("Перетягніть файли виписок сюди або оберіть їх")).toBeNull();
    release({ status: 200, body: { items: ACCOUNTS, nextCursor: null } });
    expect(await screen.findByText("Перетягніть файли виписок сюди або оберіть їх")).toBeTruthy();
  });

  it("IMP-08@PoC FR 16: with no active account the step is empty: it says so and leads to «Додати рахунок», no dropzone", async () => {
    const { client } = api({
      "GET /v1/accounts": {
        status: 200,
        body: {
          items: [{ ...account(CURRENT, "current", "Закритий", "0001"), status: "closed" }],
          nextCursor: null,
        },
      },
    });
    renderAt("#/import", client);
    expect(await screen.findByText("Немає рахунків для імпорту")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Додати рахунок" }).getAttribute("href")).toBe(
      "#/money/accounts/new",
    );
    expect(screen.queryByText("Перетягніть файли виписок сюди або оберіть їх")).toBeNull();
  });

  it("IMP-08@PoC FR 16: a failed accounts request is «✕ Помилка» with «Код: …» and «Спробувати ще раз» that reads again", async () => {
    let calls = 0;
    const { client } = api({
      "GET /v1/accounts": () => {
        calls += 1;
        return calls === 1
          ? problem(500, "INTERNAL")
          : { status: 200, body: { items: ACCOUNTS, nextCursor: null } };
      },
    });
    renderAt("#/import", client);
    expect(await screen.findByText("Не вдалося завантажити рахунки.")).toBeTruthy();
    expect(screen.getByText(`Код: ${SUPPORT_ID}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByText("Перетягніть файли виписок сюди або оберіть їх")).toBeTruthy();
  });

  it("IMP-08@PoC FR 16: the empty step names the formats and the ceilings of IMP-01 FR 13", async () => {
    const { client } = api();
    renderAt("#/import", client);
    expect(
      await screen.findByText("CSV, TSV, XLSX, XLS · до 25 МБ і 20 000 рядків у файлі · до 50 файлів"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Обрати файли" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Файли імпорту" })).toBeNull();
  });
});

describe("IMP-08@PoC FR 16 — refusals and retry per file", () => {
  it("IMP-01@PoC AC12: a book refused for its format is named per file and does not stop the CSV next to it", async () => {
    const { client } = api({
      "POST /v1/import/batches/{b}/files": {
        status: 201,
        body: {
          batch: batch("uploaded", 1, 1),
          files: [
            file(F1, "ok.csv"),
            file(F2, "macro.xlsx", {
              status: "rejected",
              format: null,
              sizeBytes: null,
              rejectionCode: "UNSUPPORTED_FORMAT",
              rejection: { code: "UNSUPPORTED_FORMAT", message: { uk: "Формат не підтримується", en: "x" } },
            }),
          ],
          refused: [],
        },
      },
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: {
          ...batch("uploaded", 1, 1),
          fileList: [
            file(F1, "ok.csv"),
            file(F2, "macro.xlsx", {
              status: "rejected",
              format: null,
              sizeBytes: null,
              rejectionCode: "UNSUPPORTED_FORMAT",
            }),
          ],
        },
      },
      "GET /v1/import/batches/{b}/parse": { status: 200, body: view([parsed(F1)]) },
    });
    renderAt("#/import", client);
    await screen.findByText("Обрати файли");
    pick([csv("ok.csv"), csv("macro.xlsx")]);
    await waitFor(() => expect(stateOf("ok.csv").getByText("Готовий")).toBeTruthy());
    const bad = stateOf("macro.xlsx");
    expect(bad.getByText("Формат не підтримується")).toBeTruthy();
    expect(bad.getByText("Код: UNSUPPORTED_FORMAT")).toBeTruthy();
    expect(bad.getByText("Помилка")).toBeTruthy();
    expect(bad.getByRole("button", { name: "Завантажте інший файл" })).toBeTruthy();
    // The refused file does not stop the step: «Далі» is available for the CSV.
    expect(disabled(nextButton())).toBe(false);
    expect(nextButton().getAttribute("href")).toBe(`#/import/${BATCH}/review`);
  });

  it("IMP-01@PoC AC2: a file over the row ceiling is refused with the ceiling and the advice to split it, without a plan hint", async () => {
    const { client } = api({
      "POST /v1/import/batches/{b}/files": {
        status: 422,
        body: {
          type: "urn:willowsum:problem:file_rejected",
          title: "FILE_REJECTED",
          status: 422,
          code: "FILE_REJECTED",
          supportId: SUPPORT_ID,
          rejection: { code: "TOO_MANY_ROWS", ceiling: { name: "rows", limit: 20000 } },
        },
        headers: { "content-type": "application/problem+json" },
      },
    });
    renderAt("#/import", client);
    await screen.findByText("Обрати файли");
    pick([csv("big.csv", 900)]);
    const row = await waitFor(() =>
      stateOf("big.csv")
        .getByText(/Занадто багато рядків/)
        .closest("li")!,
    );
    const text = plain(row.textContent);
    expect(text).toContain("до 20 000 рядків");
    expect(text).toContain("Розділіть файл, наприклад за періодом");
    expect(text).not.toMatch(/план|Plus|Family|Free/i);
    expect(within(row).getByText("Код: TOO_MANY_ROWS")).toBeTruthy();
  });

  it("IMP-08@PoC FR 16: a file over 25 MB is refused before it is sent, with the ceiling and the advice to split it", async () => {
    const { client, of } = api();
    renderAt("#/import", client);
    await screen.findByText("Обрати файли");
    pick([csv("huge.csv", 26 * 1024)]);
    const row = (await screen.findByText("huge.csv")).closest("li")!;
    expect(plain(row.textContent)).toContain("Файл більший за 25 МБ. Розділіть файл, наприклад за періодом");
    expect(within(row).getByRole("button", { name: "Завантажте інший файл" })).toBeTruthy();
    expect(of("POST", "/v1/import/batches")).toHaveLength(0);
    expect(of("POST", "/v1/import/batches/{b}/files")).toHaveLength(0);
  });

  it("IMP-08@PoC FR 16: the 25 MiB ceiling is exact: 25 MiB goes up, 25 MiB and one byte is refused before sending", async () => {
    const { client, of } = api({
      "POST /v1/import/batches/{b}/files": {
        status: 201,
        body: { batch: batch("uploaded", 1), files: [file(F1, "exact.csv")], refused: [] },
      },
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("uploaded", 1), fileList: [file(F1, "exact.csv")] },
      },
      "GET /v1/import/batches/{b}/parse": { status: 200, body: view([parsed(F1)]) },
    });
    renderAt("#/import", client);
    await screen.findByText("Обрати файли");
    pick([sized("exact.csv", 25 * 1024 * 1024), sized("over.csv", 25 * 1024 * 1024 + 1)]);
    const over = (await screen.findByText("over.csv")).closest("li")!;
    expect(plain(over.textContent)).toContain("Файл більший за 25 МБ");
    await waitFor(() => expect(of("POST", "/v1/import/batches/{b}/files")).toHaveLength(1));
    expect(of("POST", "/v1/import/batches/{b}/files")[0]!.parts).toBe(1);
    expect(plain(screen.getByText("exact.csv").closest("li")!.textContent)).not.toContain("Файл більший");
  });

  it("IMP-08@PoC FR 16: a file the server refuses without a row (no place left in the batch) is named with its code", async () => {
    const { client } = api({
      "POST /v1/import/batches/{b}/files": {
        status: 201,
        body: {
          batch: batch("uploaded", 1),
          files: [file(F1, "ok.csv")],
          refused: [
            {
              fileName: "fifty-first.csv",
              rejection: {
                code: "BATCH_TOO_MANY_FILES",
                message: {
                  uk: "У партії може бути до 50 файлів. Розділіть завантаження на кілька партій.",
                  en: "x",
                },
              },
            },
          ],
        },
      },
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("uploaded", 1), fileList: [file(F1, "ok.csv")] },
      },
      "GET /v1/import/batches/{b}/parse": { status: 200, body: view([parsed(F1)]) },
    });
    renderAt("#/import", client);
    await screen.findByText("Обрати файли");
    pick([csv("ok.csv"), csv("fifty-first.csv")]);
    await screen.findByText(/У партії може бути до 50 файлів/);
    const row = screen.getByText("fifty-first.csv").closest("li")!;
    expect(within(row).getByText("Код: BATCH_TOO_MANY_FILES")).toBeTruthy();
  });

  it("IMP-08@PoC FR 16: a parse error shows the API's reason and code per file; «Спробувати ще раз» parses that file again", async () => {
    let failing = true;
    const { client, of } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("needs-review", 2), fileList: [file(F1, "good.csv"), file(F2, "slow.xlsx")] },
      },
      "GET /v1/import/batches/{b}/parse": () => ({
        status: 200,
        body: view([
          parsed(F1),
          failing
            ? parsed(F2, {
                state: "failed",
                accountId: null,
                rowCount: null,
                refusal: {
                  code: "PARSE_TIMEOUT",
                  message: {
                    uk: "Розбір триває занадто довго (понад 60 с). Розділіть файл, наприклад за періодом, і завантажте частини.",
                    en: "x",
                  },
                },
              })
            : parsed(F2),
        ]),
      }),
      "POST /v1/import/batches/{b}/parse": () => {
        failing = false;
        return { status: 200, body: batch("processing") };
      },
    });
    renderAt(`#/import/${BATCH}`, client);
    const bad = await waitFor(() => stateOf("slow.xlsx"));
    expect(await bad.findByText(/Розбір триває занадто довго/)).toBeTruthy();
    expect(bad.getByText("Код: PARSE_TIMEOUT")).toBeTruthy();
    expect(bad.getByText("Помилка")).toBeTruthy();
    expect(stateOf("good.csv").getByText("Готовий")).toBeTruthy();
    fireEvent.click(bad.getByRole("button", { name: "Спробувати ще раз" }));
    await waitFor(() => expect(stateOf("slow.xlsx").getByText("Готовий")).toBeTruthy());
    expect(of("POST", "/v1/import/batches/{b}/parse").at(-1)?.body).toEqual({ files: [{ fileId: F2 }] });
  });

  it("IMP-08@PoC FR 16: a lost connection during the upload keeps the file in the list with «Спробувати ще раз» that sends it again", async () => {
    let attempts = 0;
    const { client, of } = api({
      "POST /v1/import/batches/{b}/files": () => {
        attempts += 1;
        return attempts === 1
          ? "network"
          : { status: 201, body: { batch: batch("uploaded", 1), files: [file(F1, "ok.csv")], refused: [] } };
      },
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("uploaded", 1), fileList: [file(F1, "ok.csv")] },
      },
      "GET /v1/import/batches/{b}/parse": { status: 200, body: view([parsed(F1)]) },
    });
    renderAt("#/import", client);
    await screen.findByText("Обрати файли");
    pick([csv("ok.csv")]);
    const row = (await screen.findByText("Не вдалося завантажити файл. Перевірте з'єднання.")).closest("li")!;
    expect(within(row).getByText("Помилка")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Спробувати ще раз" }));
    await waitFor(() => expect(stateOf("ok.csv").getByText("Готовий")).toBeTruthy());
    expect(of("POST", "/v1/import/batches/{b}/files")).toHaveLength(2);
    expect(of("POST", "/v1/import/batches")).toHaveLength(1);
  });

  it("IMP-08@PoC FR 16: when the status of the files cannot be read the step says so and «Спробувати ще раз» reads it again", async () => {
    let calls = 0;
    const { client } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("processing", 1), fileList: [file(F1, "a.csv")] },
      },
      "GET /v1/import/batches/{b}/parse": () => {
        calls += 1;
        return calls === 1 ? problem(503, "MODULE_UNAVAILABLE") : { status: 200, body: view([parsed(F1)]) };
      },
    });
    renderAt(`#/import/${BATCH}`, client);
    expect(await screen.findByText("Не вдалося оновити стан файлів.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    await waitFor(() => expect(stateOf("a.csv").getByText("Готовий")).toBeTruthy());
  });
});

describe("IMP-08@PoC — the footer: «Скасувати» and «Далі»", () => {
  it("IMP-08@PoC FR 16: «Далі» is disabled with its reason while no file is there, while files parse, and while an account is missing", async () => {
    const { client } = api();
    renderAt("#/import", client);
    await screen.findByText("Обрати файли");
    const next = screen.getByRole("button", { name: "Далі" });
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Завантажте хоча б один файл.")).toBeTruthy();
  });

  it("IMP-08@PoC FR 16: «Скасувати» cancels the open batch and leaves the wizard", async () => {
    const { client, of } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("parsed", 1), fileList: [file(F1, "a.csv")] },
      },
      "GET /v1/import/batches/{b}/parse": { status: 200, body: view([parsed(F1)]) },
    });
    renderAt(`#/import/${BATCH}`, client);
    await screen.findByText("a.csv");
    fireEvent.click(screen.getByRole("button", { name: "Скасувати" }));
    await waitFor(() => expect(of("POST", "/v1/import/batches/{b}/cancel")).toHaveLength(1));
    await waitFor(() => expect(window.location.hash).toBe("#/money/transactions"));
  });

  it("IMP-08@PoC FR 16: the footer counts the files by state", async () => {
    const { client } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("needs-review", 2), fileList: [file(F1, "a.csv"), file(F2, "b.csv")] },
      },
      "GET /v1/import/batches/{b}/parse": {
        status: 200,
        body: view([parsed(F1), parsed(F2, { accountId: null })]),
      },
    });
    renderAt(`#/import/${BATCH}`, client);
    expect(
      await screen.findByText("Готових: 1 · розбирається: 0 · потребує дії: 1 · з помилкою: 0"),
    ).toBeTruthy();
    expect(screen.getByText("Оберіть рахунок для кожного файлу.")).toBeTruthy();
  });
});

describe("IMP-08@PoC FR 14, FR 15 — keyboard, names, no sideways scroll", () => {
  it("IMP-08@PoC FR 14: every control is a native button, link or select with an accessible name, and none takes a positive tabindex", async () => {
    const { client } = api({
      "GET /v1/import/batches/{b}": {
        status: 200,
        body: { ...batch("parsed", 1), fileList: [file(F1, "a.csv")] },
      },
      "GET /v1/import/batches/{b}/parse": { status: 200, body: view([parsed(F1, { accountId: null })]) },
    });
    renderAt(`#/import/${BATCH}`, client);
    await screen.findByRole("combobox", { name: "Рахунок для файлу a.csv" });
    const main = document.querySelector("main")!;
    for (const el of main.querySelectorAll<HTMLElement>("button, a[href], select, input")) {
      if (el.getAttribute("type") === "file") continue;
      expect(el.getAttribute("tabindex") ?? "0").not.toMatch(/^[1-9]/);
      const name = el.getAttribute("aria-label") ?? el.textContent ?? el.id;
      expect(plain(name).trim().length).toBeGreaterThan(0);
    }
    // The hidden file input is reached through the visible «Обрати файли» button, which is a real button.
    expect(screen.getByRole("button", { name: "Обрати файли" }).tagName).toBe("BUTTON");
  });

  it("IMP-08@PoC FR 14: the stylesheet lets long names and one long word wrap and the list never scrolls the page sideways", () => {
    expect(css).toMatch(/\.imp-name[^{]*\{[^}]*overflow-wrap: anywhere/s);
    expect(css).toMatch(/minmax\(0, 1fr\)/);
    expect(css).not.toMatch(/overflow-x:\s*(scroll|auto)/);
  });
});
