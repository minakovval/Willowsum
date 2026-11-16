import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { REFRESH_GAP_MS, SESSION_END_KEY } from "./session.ts";
import { fakeApi, plain, problem, renderAt, resetAuthState, type Reply } from "./testing.tsx";

/**
 * ACC-04@PoC on the web (S-004 «Сесію завершено…», canvas PocSignInSessionEnded): the client tells the server about
 * user actions only, never counts down or warns, and opens the sign-in screen with the reason once the server ends
 * the session. The timeout itself is the server's (apps/api …/acc04-sessions.it.test.ts).
 */
const SESSION_OK: Reply = { status: 200, body: { name: "Олена", email: "olena@example.com" } };
const REFRESHED: Reply = { status: 200, body: { status: "active", idleTimeoutS: 900, expiresInS: 43_000 } };

function ended(reason: string): Reply {
  const reply = problem(401, "SESSION_ENDED") as {
    status: number;
    body: object;
    headers: Record<string, string>;
  };
  return { ...reply, body: { ...reply.body, sessionEndReason: reason } };
}

const refreshes = (calls: readonly { method: string; path: string }[]) =>
  calls.filter((c) => c.method === "POST" && c.path === "/v1/session/refresh").length;
const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(() => vi.useRealTimers());

describe("ACC-04@PoC web session", () => {
  it("ACC-04@PoC AC1: after 15 min idle the next action opens «Вхід» with «Сесію завершено через бездіяльність»; no countdown", async () => {
    const { client, calls } = fakeApi({
      "GET /v1/session": SESSION_OK,
      "POST /v1/session/refresh": ended("idle"),
    });
    renderAt("#/planning/budget", client);
    await waitFor(() => expect(calls.length).toBe(1));
    // Nothing on the page counts down or warns before the end (FR 1: «без попередження з відліком»).
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(heading()).toBe("Вхід"));
    const notice = screen.getByText(/Сесію завершено через бездіяльність/).closest('[role="status"]')!;
    expect(plain(notice.textContent)).toContain("Сесію завершено через бездіяльність.");
    expect(plain(notice.textContent)).toContain("Минуло 15 хвилин без дій.");
    // The marker is an icon next to the words: not the colour alone (NFR-08).
    expect(notice.querySelector(".auth-notice-icon svg")).not.toBeNull();
    // The reason does not stay in the address: a reload shows the plain screen.
    expect(window.location.hash).toBe("#/login");
  });

  it("ACC-04@PoC «Стани інтерфейсу»: an end from another device says «Сесію завершено з іншого пристрою»", async () => {
    const { client } = fakeApi({ "GET /v1/session": ended("ended-elsewhere") });
    renderAt("#/money/accounts", client);
    expect(plain((await screen.findByText(/Сесію завершено з іншого пристрою/)).textContent)).toContain(
      "з іншого пристрою",
    );
    expect(heading()).toBe("Вхід");
  });

  it("ACC-04@PoC AC5: after the 12 h limit the plain sign-in screen opens, with no idle message", async () => {
    const { client } = fakeApi({
      "GET /v1/session": SESSION_OK,
      "POST /v1/session/refresh": ended("expired"),
    });
    renderAt("#/planning/goals", client);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeTruthy());
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.keyDown(document.body, { key: "a" });
    await waitFor(() => expect(heading()).toBe("Вхід"));
    expect(screen.queryByText(/Сесію завершено/)).toBeNull();
  });

  it("ACC-04@PoC FR 1: user actions extend the session, at most one refresh per gap; background requests never do", async () => {
    const { client, calls } = fakeApi({
      "GET /v1/session": SESSION_OK,
      "POST /v1/session/refresh": REFRESHED,
      "GET /v1/debts": { status: 200, body: { debts: [] } },
    });
    // «Борги» loads its data in the background: that is no user action.
    renderAt("#/planning/debts", client);
    await waitFor(() => expect(calls.some((c) => c.path === "/v1/debts")).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.path === "/v1/session")).toBe(true));
    expect(refreshes(calls)).toBe(0);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(refreshes(calls)).toBe(1));
    // A burst of actions inside the gap sends nothing more at once …
    fireEvent.keyDown(document.body, { key: "x" });
    fireEvent.pointerDown(document.body);
    await act(async () => {
      await Promise.resolve();
    });
    expect(refreshes(calls)).toBe(1);
    // … and its last action is sent when the gap is over, so the server's idle time starts from it.
    await act(async () => {
      vi.advanceTimersByTime(REFRESH_GAP_MS);
    });
    await waitFor(() => expect(refreshes(calls)).toBe(2));
  });

  it("ACC-04@PoC FR 1: a navigation inside the app counts as an action", async () => {
    const { client, calls } = fakeApi({
      "GET /v1/session": SESSION_OK,
      "POST /v1/session/refresh": REFRESHED,
    });
    renderAt("#/planning/budget", client);
    await waitFor(() => expect(calls.length).toBe(1));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      window.location.hash = "#/planning/goals";
    });
    await waitFor(() => expect(refreshes(calls)).toBe(1));
  });

  it("ACC-04@PoC FR 1: without a session nothing is sent for actions", async () => {
    const { client, calls } = fakeApi({ "GET /v1/session": problem(401, "UNAUTHENTICATED") });
    renderAt("#/planning/budget", client);
    await waitFor(() => expect(calls.length).toBe(1));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.pointerDown(document.body);
    await act(async () => {
      await Promise.resolve();
    });
    expect(refreshes(calls)).toBe(0);
    expect(heading()).toBe("Бюджет");
  });

  it("ACC-04@PoC FR 2, AC2: unsaved form data are lost at the end and no draft is kept; after signing in the form is empty", async () => {
    const { client, calls } = fakeApi({
      "GET /v1/session": SESSION_OK,
      "POST /v1/session/refresh": ended("idle"),
      "POST /v1/sessions": { status: 200, body: { status: "signed-in" } },
    });
    renderAt("#/planning/recurring/new", client);
    await waitFor(() => expect(calls.some((c) => c.path === "/v1/session")).toBe(true));
    await act(async () => {
      await Promise.resolve();
    });
    const field = screen.getAllByRole("textbox")[0] as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Оренда квартири" } });
    fireEvent.pointerDown(field);
    await screen.findByText(/Сесію завершено через бездіяльність/);

    const stored = [...Object.values({ ...localStorage }), ...Object.values({ ...sessionStorage })].join(" ");
    expect(stored).not.toContain("Оренда квартири");

    fireEvent.change(screen.getByRole("textbox", { name: /^Email/ }), {
      target: { value: "olena@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Пароль/, { selector: "input" }), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Увійти/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/planning/budget"));
    act(() => {
      window.location.hash = "#/planning/recurring/new";
    });
    await waitFor(() => expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0));
    for (const box of screen.getAllByRole("textbox"))
      expect((box as HTMLInputElement).value).not.toBe("Оренда квартири");
  });

  it("ACC-04@PoC FR 3, AC3: the end reached in another tab of the browser opens «Вхід» here at once", async () => {
    const { client, calls } = fakeApi({ "GET /v1/session": SESSION_OK });
    renderAt("#/planning/budget", client);
    await waitFor(() => expect(calls.length).toBe(1));
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: SESSION_END_KEY,
          newValue: JSON.stringify({ reason: "signed-out", at: Date.now() }),
        }),
      );
    });
    await waitFor(() => expect(heading()).toBe("Вхід"));
    // A sign-out shows the plain screen.
    expect(screen.queryByText(/Сесію завершено/)).toBeNull();
  });

  it("ACC-04@PoC FR 3, AC3: a tab that learns of the end tells the other tabs", async () => {
    const { client } = fakeApi({ "GET /v1/session": ended("idle") });
    renderAt("#/planning/budget", client);
    await waitFor(() => expect(heading()).toBe("Вхід"));
    expect(JSON.parse(localStorage.getItem(SESSION_END_KEY)!)).toMatchObject({ reason: "idle" });
  });

  it("ACC-04@PoC FR 3, AC3: activity in another tab is not overruled here — only the server ends the shared session", async () => {
    const { client, calls } = fakeApi({ "GET /v1/session": SESSION_OK });
    renderAt("#/planning/budget", client);
    await waitFor(() => expect(calls.length).toBe(1));
    // The page is shown again after a long time; the server says the session lives (another tab was active).
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(calls.filter((c) => c.path === "/v1/session").length).toBe(2));
    expect(heading()).toBe("Бюджет");
  });

  it("ACC-04@PoC EC2: a browser woken after the timeout shows «Вхід» once the page is shown again", async () => {
    let asleep = false;
    const { client } = fakeApi({ "GET /v1/session": () => (asleep ? ended("idle") : SESSION_OK) });
    renderAt("#/planning/budget", client);
    await waitFor(() => expect(heading()).toBe("Бюджет"));
    asleep = true;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await screen.findByText(/Сесію завершено через бездіяльність/);
  });

  it("ACC-04@PoC AC7: until the password is changed, the right password gets «Спершу змініть пароль»", async () => {
    const { client } = fakeApi({ "POST /v1/sessions": problem(403, "PASSWORD_RESET_REQUIRED") });
    renderAt("#/login", client);
    fireEvent.change(screen.getByRole("textbox", { name: /^Email/ }), {
      target: { value: "olena@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Пароль/, { selector: "input" }), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Увійти/ }));
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toContain("Помилка.");
    expect(plain(alert.textContent)).toContain("Спершу змініть пароль за посиланням");
    expect((screen.getByLabelText(/^Пароль/, { selector: "input" }) as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("link", { name: "Забули пароль?" }).getAttribute("href")).toBe(
      "#/password/reset",
    );
  });

  it("ACC-04@PoC: sign-in, sign-up and the link pages keep no session (they send nothing for it)", async () => {
    const { client, calls } = fakeApi({});
    renderAt("#/login", client);
    fireEvent.pointerDown(document.body);
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toEqual([]);
  });
});
