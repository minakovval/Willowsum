import { fireEvent, screen, waitFor } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import {
  fakeApi,
  plain,
  problem,
  renderAt,
  resetAuthState,
  SUPPORT_ID,
  TOKEN,
  type Reply,
} from "./testing.tsx";

/** ACC-04@PoC S-004b «Це був не я» (canvas PocNotMe): FR 5, AC7 on the web. */
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
const secureButton = () => screen.getByRole("button", { name: /^Захистити акаунт/ });

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

describe("ACC-04@PoC «Це був не я»", () => {
  it("ACC-04@PoC FR 5: opening the link changes nothing — the page shows the sign-in and asks to confirm", async () => {
    const { client, calls } = fakeApi({ "POST /v1/not-me-links/check": VALID });
    renderAt(`#/not-me?token=${TOKEN}`, client);
    expect(screen.getByRole("status").textContent).toContain("Перевіряємо посилання");
    expect(await screen.findByRole("heading", { level: 1, name: "Це були не ви?" })).toBeTruthy();
    expect(screen.getByText("Захистимо акаунт olena@example.com від цього входу.")).toBeTruthy();
    expect(plain(screen.getByText(/^Новий вхід ·/).textContent)).toMatch(
      /^Новий вхід · 5 лист\. 2026 р?\.?,? 21:14 UTC$/,
    );
    expect(screen.getByText("Chrome на Windows · IP 89.64.•••.12")).toBeTruthy();
    expect(screen.getByText(/Завершимо всі сесії на всіх пристроях/)).toBeTruthy();
    expect(screen.getByText(/Доки пароль не змінено, увійти не можна/)).toBeTruthy();
    expect(screen.getByText("Посилання одноразове і діє 7 днів.")).toBeTruthy();
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/v1/not-me-links/check",
        origin: window.location.origin,
        body: { token: TOKEN },
      },
    ]);
    // The token leaves the address bar once read.
    expect(window.location.hash).toBe("#/not-me");
    expect(document.title).toBe("Willowsum · Це був не я");
  });

  it("ACC-04@PoC AC7: «Захистити акаунт» ends every session and sends the reset link; the page says so", async () => {
    const { client, calls } = fakeApi({
      "POST /v1/not-me-links/check": VALID,
      "POST /v1/not-me-links/confirm": { status: 200, body: { status: "secured" } },
    });
    renderAt(`#/not-me?token=${TOKEN}`, client);
    await screen.findByRole("heading", { level: 1, name: "Це були не ви?" });
    fireEvent.click(secureButton());
    expect(await screen.findByRole("heading", { level: 1, name: "Акаунт захищено" })).toBeTruthy();
    const done = screen.getByRole("status");
    expect(plain(done.textContent)).toContain("Усі сесії завершено");
    expect(plain(done.textContent)).toContain("olena@example.com");
    expect(document.activeElement).toBe(done);
    expect(calls.at(-1)).toMatchObject({ path: "/v1/not-me-links/confirm", body: { token: TOKEN } });
    expect(screen.getByRole("link", { name: "Повернутися до входу" }).getAttribute("href")).toBe("#/login");
  });

  it("ACC-04@PoC AC7: a used link or one older than 7 days shows «Посилання недійсне»", async () => {
    const { client } = fakeApi({ "POST /v1/not-me-links/check": problem(410, "NOT_ME_LINK_INVALID") });
    renderAt(`#/not-me?token=${TOKEN}`, client);
    expect(await screen.findByRole("heading", { level: 1, name: "Посилання недійсне" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Змінити пароль" }).getAttribute("href")).toBe(
      "#/password/reset",
    );
  });

  it("ACC-04@PoC AC7: a link used meanwhile (in another tab) shows «Посилання недійсне» on confirming", async () => {
    const { client } = fakeApi({
      "POST /v1/not-me-links/check": VALID,
      "POST /v1/not-me-links/confirm": problem(410, "NOT_ME_LINK_INVALID"),
    });
    renderAt(`#/not-me?token=${TOKEN}`, client);
    await screen.findByRole("heading", { level: 1, name: "Це були не ви?" });
    fireEvent.click(secureButton());
    expect(await screen.findByRole("heading", { level: 1, name: "Посилання недійсне" })).toBeTruthy();
  });

  it("ACC-04@PoC AC7: a link without a token or with a malformed one asks nothing and shows «Посилання недійсне»", () => {
    const { client, calls } = fakeApi({});
    renderAt("#/not-me?token=short", client);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Посилання недійсне");
    expect(calls).toEqual([]);
  });

  it("ACC-04@PoC FR 5: «Це був я — нічого не робити» calls nothing on the link and leaves the page", async () => {
    const { client, calls } = fakeApi({
      "POST /v1/not-me-links/check": VALID,
      "GET /v1/session": problem(401, "UNAUTHENTICATED"),
    });
    renderAt(`#/not-me?token=${TOKEN}`, client);
    await screen.findByRole("heading", { level: 1, name: "Це були не ви?" });
    fireEvent.click(screen.getByRole("button", { name: "Це був я — нічого не робити" }));
    await waitFor(() => expect(window.location.hash).toBe("#/login"));
    expect(calls.some((c) => c.path === "/v1/not-me-links/confirm")).toBe(false);
  });

  it("ACC-04@PoC FR 5: a failed check shows «✕ Помилка» with the code and «Спробувати ще раз»; a failed confirm keeps the page", async () => {
    let fail = true;
    const { client } = fakeApi({
      "POST /v1/not-me-links/check": () => (fail ? "network" : VALID),
      "POST /v1/not-me-links/confirm": problem(503, "MODULE_UNAVAILABLE"),
    });
    renderAt(`#/not-me?token=${TOKEN}`, client);
    expect(plain((await screen.findByRole("alert")).textContent)).toContain("Не вдалося з’єднатися");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    await screen.findByRole("heading", { level: 1, name: "Це були не ви?" });
    fireEvent.click(secureButton());
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toContain("Помилка.");
    expect(alert.querySelector(".auth-notice-code")!.textContent).toBe(`Код: ${SUPPORT_ID}`);
    expect(secureButton()).toBeTruthy();
  });

  it("ACC-04@PoC AC7: «Захистити акаунт» shows that it works and is not pressed twice", async () => {
    let release: (r: Reply) => void = () => undefined;
    const { client, calls } = fakeApi({
      "POST /v1/not-me-links/check": VALID,
      "POST /v1/not-me-links/confirm": () => new Promise<Reply>((r) => (release = r)),
    });
    renderAt(`#/not-me?token=${TOKEN}`, client);
    await screen.findByRole("heading", { level: 1, name: "Це були не ви?" });
    fireEvent.click(secureButton());
    await waitFor(() => expect(secureButton().getAttribute("aria-busy")).toBe("true"));
    fireEvent.click(secureButton());
    release({ status: 200, body: { status: "secured" } });
    await screen.findByRole("heading", { level: 1, name: "Акаунт захищено" });
    expect(calls.filter((c) => c.path === "/v1/not-me-links/confirm")).toHaveLength(1);
  });
});
