import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import {
  fakeApi,
  problem,
  renderAt,
  resetAuthState,
  TOKEN,
  type Call,
  type Reply,
} from "../auth/testing.tsx";

/**
 * Security review of PR #364 (ACC-05@PoC FR 5; NFR-01@PoC FR 13, AC7, AC8): the step-up confirmation and both
 * passwords live only in memory — never in localStorage, sessionStorage, the URL, the console or an error text.
 * Synthetic values, built at run time so no secret-shaped literal is in the file.
 */
const CURRENT = ["synthetic", "current", "value", "1"].join("-");
const NEW_ONE = ["synthetic", "new", "value", "22"].join("-");
const TOKEN_2 = "C".repeat(43);
const PROFILE = {
  name: "Олена Коваленко",
  email: "olena@example.test",
  locale: "uk-UA",
  timeZone: "Europe/Kyiv",
};
const SECRETS = [CURRENT, NEW_ONE, TOKEN, TOKEN_2];

const consoleLines: string[] = [];
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
  localStorage.clear();
  sessionStorage.clear();
  consoleLines.length = 0;
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      consoleLines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    });
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ok = (body: unknown): Reply => ({ status: 200, body });
const dialog = () => screen.getByRole("dialog", { name: "Підтвердіть, що це ви" });

function expectNoSecretOutsideMemory() {
  const places = {
    localStorage: JSON.stringify({ ...localStorage }),
    sessionStorage: JSON.stringify({ ...sessionStorage }),
    url: window.location.href + " " + document.referrer,
    cookie: document.cookie,
    console: consoleLines.join("\n"),
    // What the user sees, and what is in the DOM attributes (a token must not be written into the page).
    page: document.body.outerHTML.replace(/value="[^"]*"/g, ""),
  };
  for (const [where, text] of Object.entries(places)) {
    for (const s of SECRETS) expect(text.includes(s), `${where} holds a secret`).toBe(false);
  }
}

async function openAndChange(handlers: Record<string, Reply | ((c: Call) => Reply)>) {
  const api = fakeApi({ "GET /v1/profile": ok(PROFILE), ...handlers });
  renderAt("#/settings/profile", api.client);
  await screen.findByRole("textbox", { name: /^Ім’я/ });
  fireEvent.click(screen.getByRole("button", { name: "Змінити пароль" }));
  fireEvent.change(screen.getByLabelText(/^Новий пароль/), { target: { value: NEW_ONE } });
  fireEvent.click(screen.getByRole("button", { name: "Зберегти пароль" }));
  return api;
}
function confirm() {
  fireEvent.change(within(dialog()).getByLabelText(/^Поточний пароль/), { target: { value: CURRENT } });
  fireEvent.click(within(dialog()).getByRole("button", { name: "Підтвердити" }));
}

describe("PR #364 security: step-up confirmation and passwords stay in memory", () => {
  it("NFR-01@PoC AC7: after a successful change no password or confirmation is in storage, the URL, the console or the page", async () => {
    const { calls } = await openAndChange({
      "POST /v1/session/step-up": ok({ stepUpToken: TOKEN, expiresInS: 300 }),
      "POST /v1/profile/password": ok({ status: "password-changed" }),
    });
    confirm();
    await screen.findByText(/Пароль змінено/);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain("POST /v1/profile/password");
    // Nothing secret travels in a URL (query or path).
    for (const c of calls) for (const s of SECRETS) expect(c.path.includes(s)).toBe(false);
    expectNoSecretOutsideMemory();
  });

  it("NFR-01@PoC AC8: STEP_UP_REQUIRED reopens the dialog; the refused confirmation is not reused and nothing is stored", async () => {
    const tokens = [TOKEN, TOKEN_2];
    const { calls } = await openAndChange({
      "POST /v1/session/step-up": () => ok({ stepUpToken: tokens.shift(), expiresInS: 300 }),
      "POST /v1/profile/password": (c) =>
        (c.body as { stepUpToken: string }).stepUpToken === TOKEN
          ? problem(403, "STEP_UP_REQUIRED")
          : ok({ status: "password-changed" }),
    });
    confirm();
    await within(await screen.findByRole("dialog")).findByText(/Підтвердження більше не діє/);
    expect(within(dialog()).getByLabelText(/^Поточний пароль/)).toHaveProperty("value", "");
    expectNoSecretOutsideMemory();
    confirm();
    await screen.findByText(/Пароль змінено/);
    const sent = calls
      .filter((c) => c.path === "/v1/profile/password")
      .map((c) => (c.body as { stepUpToken: string }).stepUpToken);
    expect(sent).toEqual([TOKEN, TOKEN_2]);
    expectNoSecretOutsideMemory();
  });

  it("NFR-01@PoC AC7: the password change is never sent without a fresh step-up, and closing the reopened dialog sends nothing", async () => {
    const { calls } = await openAndChange({
      "POST /v1/session/step-up": ok({ stepUpToken: TOKEN, expiresInS: 300 }),
      "POST /v1/profile/password": problem(403, "STEP_UP_REQUIRED"),
    });
    expect(calls.filter((c) => c.path === "/v1/profile/password")).toEqual([]);
    confirm();
    await within(await screen.findByRole("dialog")).findByText(/Підтвердження більше не діє/);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Скасувати" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Зберегти пароль" }));
    expect(dialog()).toBeTruthy();
    // Every POST /v1/profile/password follows its own step-up answer.
    const order = calls.filter((c) => c.method === "POST").map((c) => c.path);
    expect(order).toEqual(["/v1/session/step-up", "/v1/profile/password"]);
  });

  it("an error answer that echoes the password or the confirmation is never shown: only the general text and the code", async () => {
    const echo = (status: number, code: string): Reply => {
      const r = problem(status, code) as Exclude<Reply, "network">;
      return {
        ...r,
        body: { ...(r.body as object), title: `${code} ${CURRENT} ${TOKEN}`, detail: `${NEW_ONE} ${TOKEN}` },
      };
    };
    await openAndChange({
      "POST /v1/session/step-up": ok({ stepUpToken: TOKEN, expiresInS: 300 }),
      "POST /v1/profile/password": echo(500, "INTERNAL"),
    });
    confirm();
    await screen.findByRole("alert");
    expectNoSecretOutsideMemory();
  });
});
