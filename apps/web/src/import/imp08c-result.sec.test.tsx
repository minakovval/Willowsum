import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import {
  fakeApi,
  problem,
  renderAt,
  resetAuthState,
  SUPPORT_ID,
  type Call,
  type Reply,
} from "../auth/testing.tsx";
import { importPath } from "../routing/routes.ts";
import { resetNavigationSession } from "../routing/session.ts";
import { armApply, takeApplyIntent } from "./applyIntent.ts";

/**
 * IMP-08@PoC c) (wave 2, row 138) — the step «Результат» of the import wizard, S-174 (canvas PocMoneyImport3 and the «Тексти»
 * board PocMoneyImport3Texts), on the import-sessions routes: `GET …/import/batches/{id}`, `POST …/apply` (IMP-01, IMP-05
 * FR 11, IMP-04 FR 7), `GET …/result` (#673), `POST …/rollback` (IMP-04 FR 8, #666). Synthetic batches and rows only.
 */

const BATCH = "00000000-0000-4000-8000-0000000000b1";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const F2 = "00000000-0000-4000-8000-0000000000f2";
const NAME1 = "privat-oct-2026.xls";
const NAME2 = "mono-oct-2026.csv";

const FUTURE = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();

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
    [`GET /v1/import/batches/${BATCH}/rollback`]: () => ({
      status: 200,
      body: { batch: batchOf("applied"), rollback: { transactions: 9, changed: 1, transfers: 0 } },
    }),
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

describe("IMP-08@PoC c) follow-ups of #677 (security probes, issue #678)", () => {
  it("P1 back/forward: leaving the step mid-apply and coming back joins the same request — one apply", async () => {
    let release: (r: Reply) => void = () => undefined;
    const gate = new Promise<Reply>((r) => (release = r));
    let applied2 = false;
    const { client, calls } = api({
      [`POST /v1/import/batches/${BATCH}/apply`]: () => gate.then((r) => ((applied2 = true), r)),
      [`GET /v1/import/batches/${BATCH}`]: () => ({
        status: 200,
        body: detail(applied2 ? "applied" : "needs-review"),
      }),
    });
    const a = renderAt(at, client);
    await screen.findByRole("heading", { name: "Застосовуємо партію…" });
    a.unmount();
    renderAt(at, client, { strict: true });
    release({ status: 200, body: applied() });
    expect(await screen.findByRole("heading", { name: "Імпорт завершено" })).toBeTruthy();
    expect(posts(calls, "/apply")).toHaveLength(1);
  });

  it("P2 back/forward after the apply: the remount reads the applied batch and sends no second apply", async () => {
    let done = false;
    const { client, calls } = api({
      [`POST /v1/import/batches/${BATCH}/apply`]: () => ((done = true), { status: 200, body: applied() }),
      [`GET /v1/import/batches/${BATCH}`]: () => ({
        status: 200,
        body: detail(done ? "applied" : "needs-review"),
      }),
    });
    const a = renderAt(at, client, { strict: true });
    await screen.findByRole("heading", { name: "Імпорт завершено" });
    a.unmount();
    renderAt(at, client, { strict: true });
    await screen.findByText(/Партію вже застосовано/);
    expect(posts(calls, "/apply")).toHaveLength(1);
  });

  it("P3 rollback: opening the dialog and «Скасувати» send nothing; a double click on confirm sends one request", async () => {
    let release: (r: Reply) => void = () => undefined;
    const gate = new Promise<Reply>((r) => (release = r));
    const { client, calls } = api({ [`POST /v1/import/batches/${BATCH}/rollback`]: () => gate });
    renderAt(at, client);
    await screen.findByRole("heading", { name: "Імпорт завершено" });
    fireEvent.click(screen.getByRole("button", { name: "Відкотити партію" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Залишити змінені вручну" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Скасувати|Залишити/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posts(calls, "/rollback")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Відкотити партію" }));
    dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Буде відкочено транзакцій/);
    const ok = within(dialog).getByRole("button", { name: "Відкотити" });
    fireEvent.click(ok);
    fireEvent.click(ok);
    await waitFor(() => expect(posts(calls, "/rollback")).toHaveLength(1));
    release(problem(500, "INTERNAL"));
    await within(dialog).findByText(/Помилка/);
    expect(posts(calls, "/rollback")).toHaveLength(1);
  });

  it("P4 rollback: no rollbackUntil, or a batch not applied, offers no rollback", async () => {
    const { client } = api({
      [`GET /v1/import/batches/${BATCH}/result`]: () => ({
        status: 200,
        body: resultOf("applied", { batch: batchOf("applied", { rollbackUntil: null }) }),
      }),
    });
    renderAt(at, client);
    await screen.findByRole("heading", { name: "Імпорт завершено" });
    expect(screen.queryByRole("button", { name: "Відкотити партію" })).toBeNull();
  });

  it("P5 refused rows: issue codes and file names are text, never markup; an unknown file id is not looked up elsewhere", async () => {
    const { client } = api({
      [`POST /v1/import/batches/${BATCH}/apply`]: () =>
        refused([
          { path: `files[${F1}].rows[7]`, issue: "<img src=x onerror=alert(1)>" },
          { path: "files[zzz].rows[1]", issue: "fee" },
        ]),
    });
    const { container } = renderAt(at, client);
    await screen.findByText(/onerror=alert\(1\)/);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("Створено")).toBeNull();
  });

  it("P6 IMP-08@PoC c): a batch in parsed/needs-review reached by the address alone (no click) is not applied; the button applies it once", async () => {
    takeApplyIntent(BATCH);
    const { client, calls } = api();
    renderAt(at, client, { strict: true });
    await screen.findByRole("heading", { name: "Застосувати партію?" });
    expect(posts(calls, "/apply")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Застосувати" }));
    expect(await screen.findByRole("heading", { name: "Імпорт завершено" })).toBeTruthy();
    expect(posts(calls, "/apply")).toHaveLength(1);
  });

  it("P7 IMP-08@PoC c): a batch applied but reported applying:true gets the idempotent apply again, then its result", async () => {
    const { client, calls } = api(
      {
        [`GET /v1/import/batches/${BATCH}`]: () => ({
          status: 200,
          body: { ...detail("applied"), applying: true },
        }),
      },
      "applied",
    );
    renderAt(at, client);
    expect(await screen.findByRole("heading", { name: "Імпорт завершено" })).toBeTruthy();
    expect(posts(calls, "/apply")).toHaveLength(1);
  });

  it("P8 IMP-08@PoC c): «Спробувати ще раз» after a failed apply applies again (a new click), once", async () => {
    let n = 0;
    let release: (r: Reply) => void = () => undefined;
    const gate = new Promise<Reply>((r) => (release = r));
    const { client, calls } = api({
      [`POST /v1/import/batches/${BATCH}/apply`]: () => (++n === 1 ? problem(500, "INTERNAL") : gate),
    });
    renderAt(at, client);
    fireEvent.click(await screen.findByRole("button", { name: /Спробувати ще раз|Повторити/ }));
    await waitFor(() => expect(posts(calls, "/apply")).toHaveLength(2));
    await screen.findByRole("heading", { name: "Застосовуємо партію…" });
    release({ status: 200, body: applied() });
    expect(await screen.findByRole("heading", { name: "Імпорт завершено" })).toBeTruthy();
    expect(posts(calls, "/apply")).toHaveLength(2);
  });

  it("P9 IMP-04@PoC FR 8: the kept changed transactions are listed after the rollback, each a link to its transaction", async () => {
    const K = "00000000-0000-4000-8000-0000000000c1";
    let rolled = false;
    const { client } = api({
      [`POST /v1/import/batches/${BATCH}/rollback`]: () => ({
        status: 200,
        body: {
          batch: ((rolled = true), batchOf("rolled-back")),
          rollback: {
            mode: "keep-changed",
            counts: { rolledBack: 9, kept: 1, transfers: 0, restored: 0 },
            kept: [K],
            rolledBackAt: "2026-11-03T10:00:00Z",
          },
          first: true,
        },
      }),
      [`GET /v1/import/batches/${BATCH}/result`]: () => ({
        status: 200,
        body: resultOf(rolled ? "rolled-back" : "applied"),
      }),
    });
    renderAt(at, client);
    await screen.findByRole("heading", { name: "Імпорт завершено" });
    fireEvent.click(screen.getByRole("button", { name: "Відкотити партію" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Буде відкочено транзакцій/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Відкотити" }));
    await screen.findByRole("heading", { name: "Партію відкочено" });
    const link = within(screen.getByRole("list", { name: "Залишені змінені транзакції" })).getByRole("link");
    expect(link.getAttribute("href")).toContain(K);
  });

  it("IMP-08@PoC c): Q1 an intent armed while an apply is in flight (second click on the review link) is not left armed for a later visit by address", async () => {
    takeApplyIntent(BATCH);
    armApply(BATCH);
    let release: (r: Reply) => void = () => undefined;
    const gate = new Promise<Reply>((r) => (release = r));
    let n = 0;
    const { client, calls } = api({
      [`POST /v1/import/batches/${BATCH}/apply`]: () => (++n === 1 ? gate : { status: 200, body: applied() }),
    });
    const a = renderAt(at, client);
    await screen.findByRole("heading", { name: "Застосовуємо партію…" });
    a.unmount();
    armApply(BATCH); // back to the review step, «Застосувати» clicked again; the result step joins the run in flight
    const b = renderAt(at, client);
    release(problem(500, "INTERNAL"));
    await screen.findByRole("alert");
    b.unmount();
    // later, the same tab opens the result step by address (no click in this visit)
    renderAt(at, client);
    await screen.findByRole("heading", { name: /Застосувати партію\?|Імпорт завершено/ });
    expect(posts(calls, "/apply")).toHaveLength(1);
  });
  it("IMP-08@PoC c): Q3 «Спробувати ще раз» after a failed read of the batch only reads: a reviewed batch then asks «Застосувати партію?», no apply", async () => {
    takeApplyIntent(BATCH);
    let n = 0;
    const { client, calls } = api({
      [`GET /v1/import/batches/${BATCH}`]: () =>
        ++n === 1 ? problem(500, "INTERNAL") : { status: 200, body: detail("needs-review") },
    });
    renderAt(at, client);
    fireEvent.click(await screen.findByRole("button", { name: /Спробувати ще раз/ }));
    await screen.findByRole("heading", { name: "Застосувати партію?" });
    expect(posts(calls, "/apply")).toHaveLength(0);
  });

  it("IMP-08@PoC c): Q4 a double click on «Застосувати» of the step sends one apply", async () => {
    takeApplyIntent(BATCH);
    let release: (r: Reply) => void = () => undefined;
    const gate = new Promise<Reply>((r) => (release = r));
    const { client, calls } = api({ [`POST /v1/import/batches/${BATCH}/apply`]: () => gate });
    renderAt(at, client, { strict: true });
    await screen.findByRole("heading", { name: "Застосувати партію?" });
    const b = screen.getByRole("button", { name: "Застосувати" });
    fireEvent.click(b);
    fireEvent.click(b);
    await screen.findByRole("heading", { name: "Застосовуємо партію…" });
    release({ status: 200, body: applied() });
    await screen.findByRole("heading", { name: "Імпорт завершено" });
    expect(posts(calls, "/apply")).toHaveLength(1);
  });
});
