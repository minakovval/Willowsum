import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { CHECK_EVERY_MS, REFRESH_GAP_MS, SIGNED_IN_KEY } from "./session.ts";
import { fakeApi, problem, renderAt, resetAuthState, TOKEN, type Reply } from "./testing.tsx";

/**
 * Security review of #365 (ACC-04@PoC FR 1, business rules «фонові запити не продовжують сесію», FR 5): the client
 * never extends a session on its own, stops sending refreshes once the server says there is no session, and a
 * letter's token leaves the address bar and is never put into browser storage.
 */
const SESSION_OK: Reply = { status: 200, body: { name: "Олена", email: "olena@example.com" } };
const REFRESHED: Reply = { status: 200, body: { status: "active", idleTimeoutS: 900, expiresInS: 43_000 } };
const VALID: Reply = {
  status: 200,
  body: {
    status: "valid",
    email: "olena@example.com",
    signedInAt: "2026-11-05T21:14:00Z",
    device: { browser: "chrome", os: "windows" },
    address: "89.64.•••.12",
  },
};
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
const checks = (calls: readonly { method: string; path: string }[]) =>
  calls.filter((c) => c.method === "GET" && c.path === "/v1/session").length;
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  // This browser signed in earlier (SignInPage sets it; review round 1 of #365).
  localStorage.setItem(SIGNED_IN_KEY, "1");
});
afterEach(() => vi.useRealTimers());

describe("ACC-04@PoC web session: security review of #365", () => {
  it("ACC-04@PoC FR 1: the 60 s check only reads the session — an idle open tab never extends it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client, calls } = fakeApi({
      "GET /v1/session": SESSION_OK,
      "POST /v1/session/refresh": REFRESHED,
    });
    renderAt("#/planning/budget", client);
    await waitFor(() => expect(checks(calls)).toBe(1));
    for (let i = 0; i < 16; i++) {
      await act(async () => {
        vi.advanceTimersByTime(CHECK_EVERY_MS);
      });
      await flush();
    }
    expect(checks(calls)).toBeGreaterThanOrEqual(16);
    expect(refreshes(calls)).toBe(0);
  });

  it("ACC-04@PoC FR 1: after a 401 without a session no action and no trailing call sends a refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let gone = false;
    const { client, calls } = fakeApi({
      "GET /v1/session": () => (gone ? problem(401, "UNAUTHENTICATED") : SESSION_OK),
      "POST /v1/session/refresh": () => (gone ? problem(401, "UNAUTHENTICATED") : REFRESHED),
    });
    renderAt("#/planning/budget", client);
    await waitFor(() => expect(checks(calls)).toBe(1));
    await flush();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(refreshes(calls)).toBe(1));
    // An action inside the gap schedules a trailing call; the session is then gone (signed out elsewhere).
    fireEvent.keyDown(document.body, { key: "x" });
    gone = true;
    // The page is shown again before the trailing call is due: the check learns there is no session.
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(checks(calls)).toBe(2));
    await flush();
    const before = refreshes(calls);
    expect(before).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(REFRESH_GAP_MS);
    });
    await flush();
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document.body, { key: "y" });
    await act(async () => {
      vi.advanceTimersByTime(REFRESH_GAP_MS * 2);
    });
    await flush();
    expect(refreshes(calls)).toBe(before);
  });

  it("ACC-04@PoC FR 1: after the end the keeper is gone — no more checks or refreshes from the sign-in screen", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client, calls } = fakeApi({
      "GET /v1/session": SESSION_OK,
      "POST /v1/session/refresh": ended("idle"),
    });
    renderAt("#/planning/budget", client);
    await waitFor(() => expect(checks(calls)).toBe(1));
    await flush();
    fireEvent.pointerDown(document.body);
    await screen.findByText(/Сесію завершено через бездіяльність/);
    const n = calls.length;
    await act(async () => {
      vi.advanceTimersByTime(CHECK_EVERY_MS * 3);
    });
    fireEvent.pointerDown(document.body);
    await flush();
    expect(calls.length).toBe(n);
  });
});

describe("ACC-04@PoC FR 5 / ACC-01@PoC FR 10 link tokens: security review of #365", () => {
  it("ACC-04@PoC FR 5: a second letter's link opened on the shown page also leaves the address bar", async () => {
    const other = "B".repeat(43);
    const { client, calls } = fakeApi({ "POST /v1/not-me-links/check": VALID });
    renderAt(`#/not-me?token=${TOKEN}`, client);
    await screen.findByRole("heading", { level: 1, name: "Це були не ви?" });
    act(() => {
      window.location.hash = `#/not-me?token=${other}`;
    });
    await waitFor(() =>
      expect(calls.filter((c) => (c.body as { token?: string } | undefined)?.token === other).length).toBe(1),
    );
    expect(window.location.hash).toBe("#/not-me");
    expect(window.location.href).not.toContain(other);
  });

  it("ACC-01@PoC FR 10: a second reset link opened on the shown page also leaves the address bar", async () => {
    const other = "C".repeat(43);
    const { client } = fakeApi({
      "POST /v1/password-resets/check": { status: 200, body: { status: "valid" } },
    });
    renderAt(`#/password/reset?token=${TOKEN}`, client);
    await waitFor(() => expect(window.location.hash).toBe("#/password/reset"));
    act(() => {
      window.location.hash = `#/password/reset?token=${other}`;
    });
    await waitFor(() => expect(window.location.hash).toBe("#/password/reset"));
  });

  it("ACC-04@PoC FR 5, ACC-01@PoC FR 10: link tokens never reach localStorage or sessionStorage", async () => {
    const { client } = fakeApi({
      "POST /v1/not-me-links/check": VALID,
      "POST /v1/not-me-links/confirm": { status: 200, body: { status: "secured" } },
      "POST /v1/password-resets/check": { status: 200, body: { status: "valid" } },
    });
    const view = renderAt(`#/not-me?token=${TOKEN}`, client);
    await screen.findByRole("heading", { level: 1, name: "Це були не ви?" });
    fireEvent.click(screen.getByRole("button", { name: /^Захистити акаунт/ }));
    await screen.findByRole("heading", { level: 1, name: /захищено/i });
    view.unmount();
    renderAt(`#/password/reset?token=${TOKEN}`, client);
    await waitFor(() => expect(window.location.hash).toBe("#/password/reset"));
    const stored = [
      ...Object.keys(localStorage),
      ...Object.values({ ...localStorage }),
      ...Object.keys(sessionStorage),
      ...Object.values({ ...sessionStorage }),
    ].join(" ");
    expect(stored).not.toContain(TOKEN);
  });
});
